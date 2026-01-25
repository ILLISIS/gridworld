import fs from "fs/promises";
import path from "path";

import * as lib from "@clusterio/lib";
import { BaseControllerPlugin, type InstanceInfo } from "@clusterio/controller";
import * as messages from "./messages";

type TileRecord = {
	x: number;
	y: number;
	instanceId: number;
	saveName: string;
	createdAtMs: number;
};

type ParsedMapSettings = {
	mapGenSettings: Record<string, any>;
	mapSettings: Record<string, any>;
	seed?: number;
};

type EdgeTargetSpec = {
	instanceId: number;
	origin: [number, number];
	surface: string;
	direction: number;
	ready: boolean;
};

type UniversalEdgesController = {
	edgeDatastore?: Map<string, { id: string; isDeleted: boolean }>;
	handleSetEdgeConfigRequest?: (request: { edge: any }) => Promise<void> | void;
};

// Universal edges uses 16-direction values where 0=east, 4=south, 8=west, 12=north.
const EDGE_DIRECTIONS = {
	north: 0,
	east: 4,
	south: 8,
	west: 12,
} as const;

const NEIGHBOR_DELTAS = [
	{ dx: 0, dy: -1 },
	{ dx: 1, dy: 0 },
	{ dx: 0, dy: 1 },
	{ dx: -1, dy: 0 },
];

function tileKey(x: number, y: number) {
	return `${x},${y}`;
}

function edgeKey(a: TileRecord, b: TileRecord) {
	const aKey = tileKey(a.x, a.y);
	const bKey = tileKey(b.x, b.y);
	return aKey < bKey ? `gridworld:${aKey}:${bKey}` : `gridworld:${bKey}:${aKey}`;
}

function deepClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

async function loadTiles(
	config: lib.ControllerConfig,
	logger: lib.Logger,
): Promise<Map<string, TileRecord>> {
	const filePath = path.resolve(config.get("controller.database_directory"), "gridworld_tiles.json");
	logger.verbose(`Loading ${filePath}`);
	try {
		const content = await fs.readFile(filePath, "utf8");
		if (!content.trim()) {
			return new Map();
		}
		const parsed = JSON.parse(content);
		const map = new Map<string, TileRecord>();
		if (Array.isArray(parsed)) {
			for (const entry of parsed) {
				if (
					entry
					&& typeof entry.x === "number"
					&& typeof entry.y === "number"
					&& typeof entry.instanceId === "number"
				) {
					const saveName = typeof entry.saveName === "string"
						? entry.saveName
						: `${config.get("gridworld.save_name_prefix")}_${entry.x}_${entry.y}.zip`;
					map.set(tileKey(entry.x, entry.y), {
						...entry,
						saveName,
					} as TileRecord);
				}
			}
		}
		return map;
	} catch (err: any) {
		if (err.code === "ENOENT") {
			logger.verbose("Creating new gridworld tile database");
			return new Map();
		}
		throw err;
	}
}

async function saveTiles(
	config: lib.ControllerConfig,
	tiles: Map<string, TileRecord>,
	logger: lib.Logger,
) {
	const filePath = path.resolve(config.get("controller.database_directory"), "gridworld_tiles.json");
	logger.verbose(`writing ${filePath}`);
	await lib.safeOutputFile(filePath, JSON.stringify([...tiles.values()], null, "\t"));
}

export class ControllerPlugin extends BaseControllerPlugin {
	private tiles = new Map<string, TileRecord>();
	private tilesByInstance = new Map<number, TileRecord>();
	private pendingTiles = new Map<string, Promise<TileRecord>>();
	private pendingStarts = new Map<number, Promise<void>>();
	private hostAssignIndex = 0;
	private storageDirty = false;
	private parsedMapSettings: ParsedMapSettings | null = null;
	private mapExchangeError: string | null = null;

	async init() {
		this.controller.handle(messages.GridworldStateRequest, this.handleGridworldStateRequest.bind(this));
		this.controller.handle(messages.GridworldCreateRequest, this.handleGridworldCreateRequest.bind(this));
		this.controller.handle(messages.GridworldDeleteRequest, this.handleGridworldDeleteRequest.bind(this));

		this.tiles = await loadTiles(this.controller.config, this.logger);
		this.rebuildTileIndex();
		this.loadMapExchangeString();

		if (this.tiles.size === 0) {
			const x = this.controller.config.get("gridworld.initial_tile_x");
			const y = this.controller.config.get("gridworld.initial_tile_y");
			await this.ensureTile(x, y, "initial");
		}

		await this.ensureEdgesForKnownTiles();
	}

	async onSaveData() {
		if (this.storageDirty) {
			this.storageDirty = false;
			await saveTiles(this.controller.config, this.tiles, this.logger);
		}
	}

	async onPlayerEvent(instance: InstanceInfo, event: lib.PlayerEvent) {
		if (event.type !== "join") {
			return;
		}
		const tile = this.tilesByInstance.get(instance.id);
		if (!tile) {
			return;
		}
		await this.ensureNeighbors(tile);
	}

	async onControllerConfigFieldChanged(field: string) {
		if (field === "gridworld.map_exchange_string") {
			this.loadMapExchangeString();
		}
	}

	private rebuildTileIndex() {
		this.tilesByInstance.clear();
		for (const [key, tile] of [...this.tiles.entries()]) {
			if (!this.controller.instances.has(tile.instanceId)) {
				this.logger.warn(`Dropping tile ${key} for missing instance ${tile.instanceId}`);
				this.tiles.delete(key);
				this.storageDirty = true;
				continue;
			}
			this.tilesByInstance.set(tile.instanceId, tile);
		}
	}

	private loadMapExchangeString() {
		const exchangeString = this.controller.config.get("gridworld.map_exchange_string");
		if (!exchangeString || !exchangeString.trim()) {
			this.parsedMapSettings = null;
			this.mapExchangeError = "Map exchange string is not configured.";
			return;
		}
		try {
			const parsed = lib.readMapExchangeString(exchangeString);
			this.parsedMapSettings = {
				mapGenSettings: parsed.map_gen_settings,
				mapSettings: parsed.map_settings,
				seed: parsed.map_gen_settings.seed,
			};
			this.mapExchangeError = null;
		} catch (err: any) {
			this.parsedMapSettings = null;
			this.mapExchangeError = err.message ?? String(err);
			this.logger.error(`Failed to parse map exchange string: ${this.mapExchangeError}`);
		}
	}

	private getUniversalEdgesController(): UniversalEdgesController | null {
		const plugin = this.controller.plugins.get("universal_edges") as UniversalEdgesController | undefined;
		if (!plugin) {
			this.logger.warn("Universal edges plugin not loaded; gridworld edges will not be created.");
			return null;
		}
		return plugin;
	}

	private async ensureTile(x: number, y: number, reason: string): Promise<TileRecord> {
		const key = tileKey(x, y);
		const existing = this.tiles.get(key);
		if (existing) {
			return existing;
		}
		const pending = this.pendingTiles.get(key);
		if (pending) {
			return await pending;
		}
		const creation = this.createTile(x, y, reason).finally(() => {
			this.pendingTiles.delete(key);
		});
		this.pendingTiles.set(key, creation);
		return await creation;
	}

	private async createTile(x: number, y: number, reason: string): Promise<TileRecord> {
		const instanceName = `gridworld_${x}_${y}`;
		const saveName = `${this.controller.config.get("gridworld.save_name_prefix")}_${x}_${y}.zip`;
		const instanceConfig = new lib.InstanceConfig("controller");
		instanceConfig.set("instance.name", instanceName, "controller");
		instanceConfig.set("instance.auto_start", false, "controller");

		await this.controller.instanceCreate(instanceConfig);
		const instanceId = instanceConfig.get("instance.id");
		const tile: TileRecord = {
			x,
			y,
			instanceId,
			saveName,
			createdAtMs: Date.now(),
		};
		this.tiles.set(tileKey(x, y), tile);
		this.tilesByInstance.set(instanceId, tile);
		this.storageDirty = true;
		this.logger.info(`Created tile ${x},${y} for instance ${instanceId} (${reason})`);

		await this.assignAndSetupInstance(tile);
		await this.ensureEdgesForTile(tile);
		return tile;
	}

	private getHostIdForTile(): number | undefined {
		const hostIds = [...this.controller.wsServer.hostConnections.keys()];
		if (!hostIds.length) {
			this.logger.warn("No hosts connected; cannot assign new gridworld instances.");
			return undefined;
		}
		hostIds.sort((a, b) => a - b);
		const hostId = hostIds[this.hostAssignIndex % hostIds.length];
		this.hostAssignIndex = (this.hostAssignIndex + 1) % hostIds.length;
		return hostId;
	}

	private async assignAndSetupInstance(tile: TileRecord) {
		const hostId = this.getHostIdForTile();
		if (hostId === undefined) {
			return;
		}
		try {
			await this.controller.instanceAssign(tile.instanceId, hostId);
		} catch (err: any) {
			this.logger.error(`Failed to assign instance ${tile.instanceId}: ${err?.message ?? err}`);
			return;
		}

		return;
	}

	private buildMapSettingsForTile(x: number, y: number): ParsedMapSettings | null {
		if (!this.parsedMapSettings) {
			return null;
		}
		const tileSize = this.controller.config.get("gridworld.tile_size");
		const offsetX = x * tileSize;
		const offsetY = y * tileSize;
		const mapGenSettings = deepClone(this.parsedMapSettings.mapGenSettings);
		const mapSettings = deepClone(this.parsedMapSettings.mapSettings);

		if (mapGenSettings.area_to_generate_at_start) {
			const area = mapGenSettings.area_to_generate_at_start;
			if (area.left_top) {
				area.left_top.x += offsetX;
				area.left_top.y += offsetY;
			}
			if (area.right_bottom) {
				area.right_bottom.x += offsetX;
				area.right_bottom.y += offsetY;
			}
		}
		if (Array.isArray(mapGenSettings.starting_points)) {
			mapGenSettings.starting_points = mapGenSettings.starting_points.map((point: { x: number; y: number }) => ({
				x: point.x + offsetX,
				y: point.y + offsetY,
			}));
		}

		const seed = typeof mapGenSettings.seed === "number"
			? mapGenSettings.seed
			: this.parsedMapSettings.seed;

		return {
			mapGenSettings,
			mapSettings,
			seed,
		};
	}

	private async ensureNeighbors(tile: TileRecord) {
		for (const delta of NEIGHBOR_DELTAS) {
			const neighbor = await this.ensureTile(tile.x + delta.dx, tile.y + delta.dy, "neighbor");
			await this.ensureInstanceStarted(neighbor, "neighbor");
			await this.ensureEdgeBetween(tile, neighbor);
		}
	}

	private async ensureEdgesForKnownTiles() {
		for (const tile of this.tiles.values()) {
			await this.ensureEdgesForTile(tile);
		}
	}

	private async ensureEdgesForTile(tile: TileRecord) {
		for (const delta of NEIGHBOR_DELTAS) {
			const neighbor = this.tiles.get(tileKey(tile.x + delta.dx, tile.y + delta.dy));
			if (neighbor) {
				await this.ensureEdgeBetween(tile, neighbor);
			}
		}
	}

	private async ensureEdgeBetween(tile: TileRecord, neighbor: TileRecord) {
		const ue = this.getUniversalEdgesController();
		if (!ue?.handleSetEdgeConfigRequest) {
			return;
		}
		const edgeId = edgeKey(tile, neighbor);
		const existingEdge = ue.edgeDatastore?.get(edgeId);
		if (existingEdge && !existingEdge.isDeleted) {
			return;
		}

		const [sourceTile, targetTile] = this.orderTiles(tile, neighbor);
		const sourceSpec = this.buildEdgeTargetSpec(sourceTile, targetTile);
		const targetSpec = this.buildEdgeTargetSpec(targetTile, sourceTile);
		const tileSize = this.controller.config.get("gridworld.tile_size");

		const edge = {
			id: edgeId,
			updatedAtMs: Date.now(),
			isDeleted: false,
			source: sourceSpec,
			target: targetSpec,
			length: tileSize,
			active: true,
			link_destinations: {},
		};

		await ue.handleSetEdgeConfigRequest({ edge });
	}

	private orderTiles(a: TileRecord, b: TileRecord): [TileRecord, TileRecord] {
		if (a.x !== b.x) {
			return a.x < b.x ? [a, b] : [b, a];
		}
		if (a.y !== b.y) {
			return a.y < b.y ? [a, b] : [b, a];
		}
		return [a, b];
	}

	private buildEdgeTargetSpec(tile: TileRecord, neighbor: TileRecord): EdgeTargetSpec {
		const bounds = this.tileBounds(tile.x, tile.y);
		const surface = this.controller.config.get("gridworld.surface_name");
		const side = this.getSide(tile, neighbor);
		const { origin, direction } = this.edgeSideSpec(bounds, side);
		return {
			instanceId: tile.instanceId,
			origin: [origin[0], origin[1]],
			surface,
			direction,
			ready: true,
		};
	}

	private getSide(tile: TileRecord, neighbor: TileRecord): "north" | "east" | "south" | "west" {
		if (neighbor.x === tile.x && neighbor.y === tile.y - 1) {
			return "north";
		}
		if (neighbor.x === tile.x && neighbor.y === tile.y + 1) {
			return "south";
		}
		if (neighbor.x === tile.x + 1 && neighbor.y === tile.y) {
			return "east";
		}
		return "west";
	}

	private tileBounds(x: number, y: number) {
		const tileSize = this.controller.config.get("gridworld.tile_size");
		const half = tileSize / 2;
		const centerX = x * tileSize;
		const centerY = y * tileSize;
		return {
			minX: centerX - half,
			maxX: centerX + half,
			minY: centerY - half,
			maxY: centerY + half,
		};
	}

	private edgeSideSpec(bounds: { minX: number; maxX: number; minY: number; maxY: number }, side: "north" | "east" | "south" | "west") {
		switch (side) {
			case "north":
				return {
					origin: [bounds.minX, bounds.minY] as [number, number],
					direction: EDGE_DIRECTIONS.north,
				};
			case "south":
				return {
					origin: [bounds.maxX, bounds.maxY] as [number, number],
					direction: EDGE_DIRECTIONS.south,
				};
			case "east":
				return {
					origin: [bounds.maxX, bounds.minY] as [number, number],
					direction: EDGE_DIRECTIONS.east,
				};
			case "west":
			default:
				return {
					origin: [bounds.minX, bounds.maxY] as [number, number],
					direction: EDGE_DIRECTIONS.west,
				};
		}
	}

	private async ensureInstanceStarted(tile: TileRecord, reason: string) {
		const pending = this.pendingStarts.get(tile.instanceId);
		if (pending) {
			await pending;
			return;
		}

		const startPromise = this.startInstanceIfNeeded(tile, reason).finally(() => {
			this.pendingStarts.delete(tile.instanceId);
		});
		this.pendingStarts.set(tile.instanceId, startPromise);
		await startPromise;
	}

	private async startInstanceIfNeeded(tile: TileRecord, reason: string) {
		const instance = this.controller.instances.get(tile.instanceId);
		if (!instance) {
			this.logger.warn(`Missing instance ${tile.instanceId} for tile ${tile.x},${tile.y}`);
			return;
		}

		if (instance.status === "running" || instance.status === "starting" || instance.status === "creating_save") {
			return;
		}

		if (instance.config.get("instance.assigned_host") === null) {
			await this.assignAndSetupInstance(tile);
		}

		const mapSettings = this.buildMapSettingsForTile(tile.x, tile.y);
		if (!mapSettings) {
			this.logger.error(`Skipping save creation for tile ${tile.x},${tile.y}: ${this.mapExchangeError}`);
			return;
		}

		const hasSave = [...this.controller.saves.values()].some(save =>
			save.instanceId === tile.instanceId && save.name === tile.saveName && !save.isDeleted
		);

		if (!hasSave) {
			try {
				await this.controller.sendTo(
					{ instanceId: tile.instanceId },
					new lib.InstanceCreateSaveRequest(
						tile.saveName,
						mapSettings.seed,
						mapSettings.mapGenSettings,
						mapSettings.mapSettings,
					),
				);
			} catch (err: any) {
				this.logger.error(
					`Failed creating save for tile ${tile.x},${tile.y}: ${err?.message ?? err}`,
				);
				return;
			}
		}

		try {
			await this.controller.sendTo(
				{ instanceId: tile.instanceId },
				new lib.InstanceStartRequest(tile.saveName),
			);
			this.logger.info(`Started tile ${tile.x},${tile.y} (${reason})`);
		} catch (err: any) {
			this.logger.error(
				`Failed starting instance ${tile.instanceId} for tile ${tile.x},${tile.y}: ${err?.message ?? err}`,
			);
		}
	}

	private getState(): messages.GridworldStateResponse {
		const tiles = [...this.tiles.values()].map(tile => ({
			x: tile.x,
			y: tile.y,
			instanceId: tile.instanceId,
			saveName: tile.saveName,
			createdAtMs: tile.createdAtMs,
		}));
		tiles.sort((a, b) => (a.y - b.y) || (a.x - b.x));

		return {
			tiles,
			tileSize: this.controller.config.get("gridworld.tile_size"),
			initialTile: {
				x: this.controller.config.get("gridworld.initial_tile_x"),
				y: this.controller.config.get("gridworld.initial_tile_y"),
			},
			mapExchangeError: this.mapExchangeError,
		};
	}

	private async handleGridworldStateRequest(_request: messages.GridworldStateRequest) {
		return this.getState();
	}

	private async handleGridworldCreateRequest(_request: messages.GridworldCreateRequest) {
		await this.resetGridworld(true);
		return this.getState();
	}

	private async handleGridworldDeleteRequest(_request: messages.GridworldDeleteRequest) {
		await this.resetGridworld(false);
		return this.getState();
	}

	private async resetGridworld(createInitial: boolean) {
		if (this.pendingTiles.size) {
			await Promise.allSettled([...this.pendingTiles.values()]);
			this.pendingTiles.clear();
		}

		const tiles = [...this.tiles.values()];
		await this.removeEdgesForTiles(tiles);

		const deletedInstanceIds = new Set<number>();
		for (const tile of tiles) {
			try {
				await this.controller.instanceDelete(tile.instanceId);
				deletedInstanceIds.add(tile.instanceId);
			} catch (err: any) {
				this.logger.error(
					`Failed deleting instance ${tile.instanceId} for tile ${tile.x},${tile.y}: ${err?.message ?? err}`,
				);
			}
		}

		const namePrefix = "gridworld_";
		for (const instance of this.controller.instances.values()) {
			if (deletedInstanceIds.has(instance.id)) {
				continue;
			}
			const name = instance.config.get("instance.name");
			if (!name.startsWith(namePrefix)) {
				continue;
			}
			try {
				await this.controller.instanceDelete(instance.id);
			} catch (err: any) {
				this.logger.error(
					`Failed deleting instance ${instance.id} (${name}): ${err?.message ?? err}`,
				);
			}
		}

		this.tiles.clear();
		this.tilesByInstance.clear();
		this.storageDirty = true;

		if (createInitial) {
			const x = this.controller.config.get("gridworld.initial_tile_x");
			const y = this.controller.config.get("gridworld.initial_tile_y");
			await this.ensureTile(x, y, "reset");
		}
	}

	private async removeEdgesForTiles(tiles: TileRecord[]) {
		const ue = this.getUniversalEdgesController();
		if (!ue?.handleSetEdgeConfigRequest || !ue.edgeDatastore) {
			return;
		}

		const tileMap = new Map(tiles.map(tile => [tileKey(tile.x, tile.y), tile]));
		const edgeIds = new Set<string>();
		for (const tile of tiles) {
			for (const delta of NEIGHBOR_DELTAS) {
				const neighbor = tileMap.get(tileKey(tile.x + delta.dx, tile.y + delta.dy));
				if (neighbor) {
					edgeIds.add(edgeKey(tile, neighbor));
				}
			}
		}

		for (const edgeId of edgeIds) {
			const edge = ue.edgeDatastore.get(edgeId);
			if (!edge || edge.isDeleted) {
				continue;
			}
			await ue.handleSetEdgeConfigRequest({
				edge: {
					...edge,
					isDeleted: true,
					updatedAtMs: Date.now(),
				},
			});
		}
	}
}
