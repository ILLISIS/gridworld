import type { Control } from "@clusterio/web_ui";
import type { GridworldStateResponse, GridworldTile } from "../../messages";

interface MinimapTileEvent {
	instance_id: number;
	surface: string;
	force: string;
	x: number;
	y: number;
	chunk: { chart_data: string };
}

interface MinimapChartTagEvent {
	instance_id: number;
	tag_data: {
		surface: string;
		force: string;
		position: [number, number];
		tag_number: number;
		start_tick?: number;
		end_tick?: number;
		text: string;
		icon?: unknown;
		last_user?: string;
	};
}

interface MinimapRecipeEvent {
	instance_id: number;
	recipe_data: {
		surface: string;
		force: string;
		position: [number, number];
		start_tick?: number;
		end_tick?: number;
		recipe?: string;
		icon?: unknown;
	};
}

interface MinimapPlayerEvent {
	instance_id: number;
	player_data: {
		surface: string;
		x: number;
		y: number;
		player_name: string;
		sec: number;
	};
}

export interface ChartTagDataWithInstance {
	instance_id: number;
	surface: string;
	force: string;
	position: [number, number];
	tag_number: number;
	start_tick?: number;
	end_tick?: number;
	text: string;
	icon?: unknown;
	last_user?: string;
}

export interface MinimapViewBounds {
	worldLeft: number;
	worldTop: number;
	worldRight: number;
	worldBottom: number;
}

export interface MinimapActiveView {
	changed: boolean;
	activeInstanceIds: number[];
}

interface GridworldDataSourceOptions {
	onViewBoundsChange?: (bounds: MinimapViewBounds) => void;
	onSurfaceForceChange?: (surface: string, force: string) => void;
}

export interface MinimapDataSource {
	setSurfaceForce(surface: string, force: string): void;
	setActiveView(bounds: MinimapViewBounds): MinimapActiveView;
	isReady(): boolean;
	getTileData(tileX: number, tileY: number, tick?: number | null): Promise<Uint8Array | null>;
	getRecipeTileData(tileX: number, tileY: number, tick?: number | null): Promise<Uint8Array | null>;
	getChartTags(): Promise<ChartTagDataWithInstance[]>;
	getPlayerPaths(): Promise<Array<{ instanceId: number; data: Uint8Array }>>;
	onTileUpdate(callback: (event: MinimapTileEvent) => void): () => void;
	onChartTagUpdate(callback: (event: MinimapChartTagEvent) => void): () => void;
	onRecipeUpdate(callback: (event: MinimapRecipeEvent) => void): () => void;
	onPlayerPositionUpdate(callback: (event: MinimapPlayerEvent) => void): () => void;
}

interface MinimapRequestConstructors {
	GetRawTileRequest: new (...args: any[]) => any;
	GetRawRecipeTileRequest: new (...args: any[]) => any;
	GetChartTagsRequest: new (...args: any[]) => any;
	GetPlayerPathRequest: new (...args: any[]) => any;
}

interface MinimapWebPlugin {
	setInstanceSurfaceFilters?(filters: Array<{ instanceId: number; surface: string }> | null): Promise<void> | void;
	onTileUpdate(callback: (event: MinimapTileEvent) => void): void;
	offTileUpdate(callback: (event: MinimapTileEvent) => void): void;
	onChartTagUpdate(callback: (event: MinimapChartTagEvent) => void): void;
	offChartTagUpdate(callback: (event: MinimapChartTagEvent) => void): void;
	onRecipeUpdate(callback: (event: MinimapRecipeEvent) => void): void;
	offRecipeUpdate(callback: (event: MinimapRecipeEvent) => void): void;
	onPlayerPositionUpdate(callback: (event: MinimapPlayerEvent) => void): void;
	offPlayerPositionUpdate(callback: (event: MinimapPlayerEvent) => void): void;
}

const TILE_SIZE = 256;
const decodeBase64ToBytes = (base64: string): Uint8Array => {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
};

const tileKey = (x: number, y: number) => `${x},${y}`;

export class GridworldDataSource implements MinimapDataSource {
	private control: Control;
	private plugin: MinimapWebPlugin | null = null;
	private requests: MinimapRequestConstructors;
	private surface = "nauvis";
	private force = "player";
	private tileSize = 0;
	private halfTile = 0;
	private tiles = new Map<string, GridworldTile>();
	private activeInstanceIds: number[] = [];
	private chartTagCache = new Map<number, ChartTagDataWithInstance[]>();
	private playerPathCache = new Map<number, Uint8Array>();
	private onViewBoundsChange?: (bounds: MinimapViewBounds) => void;
	private onSurfaceForceChange?: (surface: string, force: string) => void;
	private lastViewBounds: MinimapViewBounds | null = null;
	public validationError: string | null = null;

	constructor(
		control: Control,
		state: GridworldStateResponse,
		requests: MinimapRequestConstructors,
		plugin?: MinimapWebPlugin | null,
		options?: GridworldDataSourceOptions,
	) {
		this.control = control;
		this.requests = requests;
		this.plugin = plugin ?? control.plugins.get("minimap") as MinimapWebPlugin | undefined ?? null;
		this.onViewBoundsChange = options?.onViewBoundsChange;
		this.onSurfaceForceChange = options?.onSurfaceForceChange;
		this.updateState(state);
	}

	updateState(state: GridworldStateResponse) {
		this.tiles.clear();
		for (const tile of state.tiles) {
			this.tiles.set(tileKey(tile.x, tile.y), tile);
		}
		this.tileSize = state.tileSize;
		this.halfTile = state.tileSize / 2;
		this.validationError = this.tileSize > 0 && this.tileSize % TILE_SIZE === 0
			? null
			: `Gridworld tile size must be a positive multiple of ${TILE_SIZE}.`;
		this.activeInstanceIds = [];
		this.chartTagCache.clear();
		this.playerPathCache.clear();
		this.lastViewBounds = null;
		this.updateFilters();
	}

	setSurfaceForce(surface: string, force: string): void {
		this.surface = surface;
		this.force = force;
		this.chartTagCache.clear();
		this.playerPathCache.clear();
		this.onSurfaceForceChange?.(surface, force);
		this.updateFilters();
	}

	setActiveView(bounds: MinimapViewBounds): MinimapActiveView {
		this.updateViewBounds(bounds);
		if (!this.isReady()) {
			return { changed: false, activeInstanceIds: [] };
		}

		const next = this.collectInstancesForBounds(bounds);
		const changed = next.length !== this.activeInstanceIds.length
			|| next.some((id, index) => id !== this.activeInstanceIds[index]);
		if (changed) {
			this.activeInstanceIds = next;
			this.updateFilters();
		}
		return { changed, activeInstanceIds: [...this.activeInstanceIds] };
	}

	isReady(): boolean {
		return this.validationError === null;
	}

	async getTileData(tileX: number, tileY: number, tick?: number | null): Promise<Uint8Array | null> {
		if (!this.isReady()) {
			return null;
		}
		const instanceId = this.resolveInstanceForTile(tileX, tileY);
		if (instanceId === null) {
			return null;
		}
		const response = await this.control.send(new this.requests.GetRawTileRequest(
			instanceId,
			this.surface,
			this.force,
			tileX,
			tileY,
			tick ?? undefined,
		) as any) as { tile_data?: string | null };
		if (!response.tile_data) {
			return null;
		}
		return decodeBase64ToBytes(response.tile_data);
	}

	async getRecipeTileData(tileX: number, tileY: number, tick?: number | null): Promise<Uint8Array | null> {
		if (!this.isReady()) {
			return null;
		}
		const instanceId = this.resolveInstanceForTile(tileX, tileY);
		if (instanceId === null) {
			return null;
		}
		const response = await this.control.send(new this.requests.GetRawRecipeTileRequest(
			instanceId,
			this.surface,
			this.force,
			tileX,
			tileY,
			tick ?? undefined,
		) as any) as { recipe_tile?: string | null };
		if (!response.recipe_tile) {
			return null;
		}
		return decodeBase64ToBytes(response.recipe_tile);
	}

	async getChartTags(): Promise<ChartTagDataWithInstance[]> {
		if (!this.isReady()) {
			return [];
		}
		const result: ChartTagDataWithInstance[] = [];
		for (const instanceId of this.activeInstanceIds) {
			if (!this.chartTagCache.has(instanceId)) {
				const response = await this.control.send(new this.requests.GetChartTagsRequest(
					instanceId,
					this.surface,
					this.force,
				) as any) as { chart_tags: ChartTagDataWithInstance[] };
				const tags = response.chart_tags
					.filter(tag => this.matchesInstance(instanceId, tag.position[0], tag.position[1]))
					.map(tag => ({ ...tag, instance_id: instanceId }));
				this.chartTagCache.set(instanceId, tags);
			}
			const cached = this.chartTagCache.get(instanceId);
			if (cached) {
				result.push(...cached);
			}
		}
		return result;
	}

	async getPlayerPaths(): Promise<Array<{ instanceId: number; data: Uint8Array }>> {
		if (!this.isReady()) {
			return [];
		}
		const responses: Array<{ instanceId: number; data: Uint8Array }> = [];
		for (const instanceId of this.activeInstanceIds) {
			if (!this.playerPathCache.has(instanceId)) {
				const response = await this.control.send(new this.requests.GetPlayerPathRequest(
					instanceId,
					this.surface,
				) as any) as { positions?: string | null };
				if (response.positions) {
					this.playerPathCache.set(instanceId, decodeBase64ToBytes(response.positions));
				}
			}
			const cached = this.playerPathCache.get(instanceId);
			if (cached) {
				responses.push({ instanceId, data: cached });
			}
		}
		return responses;
	}

	onTileUpdate(callback: (event: MinimapTileEvent) => void): () => void {
		const handler = (event: MinimapTileEvent) => {
			if (!this.isReady()) { return; }
			if (!this.activeInstanceIds.includes(event.instance_id)) { return; }
			if (event.surface !== this.surface || event.force !== this.force) { return; }
			if (!this.matchesInstance(event.instance_id, event.x, event.y)) { return; }
			callback(event);
		};
		this.plugin?.onTileUpdate(handler);
		return () => {
			this.plugin?.offTileUpdate(handler);
		};
	}

	onChartTagUpdate(callback: (event: MinimapChartTagEvent) => void): () => void {
		const handler = (event: MinimapChartTagEvent) => {
			if (!this.isReady()) { return; }
			if (!this.activeInstanceIds.includes(event.instance_id)) { return; }
			if (event.tag_data.surface !== this.surface || event.tag_data.force !== this.force) { return; }
			if (!this.matchesInstance(event.instance_id, event.tag_data.position[0], event.tag_data.position[1])) {
				return;
			}
			callback(event);
		};
		this.plugin?.onChartTagUpdate(handler);
		return () => {
			this.plugin?.offChartTagUpdate(handler);
		};
	}

	onRecipeUpdate(callback: (event: MinimapRecipeEvent) => void): () => void {
		const handler = (event: MinimapRecipeEvent) => {
			if (!this.isReady()) { return; }
			if (!this.activeInstanceIds.includes(event.instance_id)) { return; }
			if (event.recipe_data.surface !== this.surface || event.recipe_data.force !== this.force) { return; }
			if (!this.matchesInstance(event.instance_id, event.recipe_data.position[0], event.recipe_data.position[1])) {
				return;
			}
			callback(event);
		};
		this.plugin?.onRecipeUpdate(handler);
		return () => {
			this.plugin?.offRecipeUpdate(handler);
		};
	}

	onPlayerPositionUpdate(callback: (event: MinimapPlayerEvent) => void): () => void {
		const handler = (event: MinimapPlayerEvent) => {
			if (!this.isReady()) { return; }
			if (!this.activeInstanceIds.includes(event.instance_id)) { return; }
			if (event.player_data.surface !== this.surface) { return; }
			if (!this.matchesInstance(event.instance_id, event.player_data.x, event.player_data.y)) { return; }
			callback(event);
		};
		this.plugin?.onPlayerPositionUpdate(handler);
		return () => {
			this.plugin?.offPlayerPositionUpdate(handler);
		};
	}

	private collectInstancesForBounds(bounds: MinimapViewBounds): number[] {
		const minX = this.gridIndexForCoord(bounds.worldLeft);
		const maxX = this.gridIndexForCoord(bounds.worldRight - 1);
		const minY = this.gridIndexForCoord(bounds.worldTop);
		const maxY = this.gridIndexForCoord(bounds.worldBottom - 1);
		const instanceIds = new Set<number>();
		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				const tile = this.tiles.get(tileKey(x, y));
				if (tile) {
					instanceIds.add(tile.instanceId);
				}
			}
		}
		return Array.from(instanceIds).sort((a, b) => a - b);
	}

	private resolveInstanceForTile(tileX: number, tileY: number): number | null {
		const minX = tileX * TILE_SIZE;
		const maxX = (tileX + 1) * TILE_SIZE;
		const minY = tileY * TILE_SIZE;
		const maxY = (tileY + 1) * TILE_SIZE;
		const gridMinX = this.gridIndexForCoord(minX);
		const gridMaxX = this.gridIndexForCoord(maxX - 1);
		const gridMinY = this.gridIndexForCoord(minY);
		const gridMaxY = this.gridIndexForCoord(maxY - 1);
		if (gridMinX !== gridMaxX || gridMinY !== gridMaxY) {
			return null;
		}
		const tile = this.tiles.get(tileKey(gridMinX, gridMinY));
		return tile ? tile.instanceId : null;
	}

	private matchesInstance(instanceId: number, worldX: number, worldY: number): boolean {
		const gridX = this.gridIndexForCoord(worldX);
		const gridY = this.gridIndexForCoord(worldY);
		const tile = this.tiles.get(tileKey(gridX, gridY));
		return tile?.instanceId === instanceId;
	}

	private gridIndexForCoord(coord: number): number {
		return Math.floor((coord + this.halfTile) / this.tileSize);
	}

	private updateFilters() {
		if (!this.plugin || !this.isReady()) {
			return;
		}
		const filters = this.activeInstanceIds.map(instanceId => ({ instanceId, surface: this.surface }));
		this.plugin.setInstanceSurfaceFilters?.(filters.length > 0 ? filters : null);
	}

	private updateViewBounds(bounds: MinimapViewBounds) {
		if (
			this.lastViewBounds
			&& this.lastViewBounds.worldLeft === bounds.worldLeft
			&& this.lastViewBounds.worldTop === bounds.worldTop
			&& this.lastViewBounds.worldRight === bounds.worldRight
			&& this.lastViewBounds.worldBottom === bounds.worldBottom
		) {
			return;
		}
		this.lastViewBounds = { ...bounds };
		this.onViewBoundsChange?.(this.lastViewBounds);
	}
}
