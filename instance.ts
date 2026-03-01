import * as lib from "@clusterio/lib";
import { BaseInstancePlugin } from "@clusterio/host";
import * as messages from "./messages";

type RailEntitiesIPC = {
	tile_x: number;
	tile_y: number;
	tile_size: number;
	entities: messages.RailEntity[];
};

export class InstancePlugin extends BaseInstancePlugin {
	private warnedMissingConfig = false;

	async init() {
		this.instance.handle(messages.GridworldSyncTileAreas, this.handleGridworldSyncTileAreas.bind(this));
		this.instance.handle(messages.GridworldApplyRailEntities, this.handleGridworldApplyRailEntities.bind(this));

		// Receive rail entity data collected by Lua via clusterio_api.send_json("gridworld:rail_entities", ...)
		(this.instance.server as any).on("ipc-gridworld:rail_entities", (data: RailEntitiesIPC) => {
			this.handleRailEntitiesIpc(data).catch(err => this.logger.error(
				`Error handling rail entities IPC:\n${err.stack}`,
			));
		});
	}

	private getBoundaryConfig(logMissing: boolean): { tileX: number; tileY: number; tileSize: number; surfaceName: string } | null {
		const tileX = this.instance.config.get("gridworld.tile_x");
		const tileY = this.instance.config.get("gridworld.tile_y");
		const tileSize = this.instance.config.get("gridworld.tile_size");
		const surfaceName = this.instance.config.get("gridworld.surface_name");

		if (
			typeof tileX !== "number"
			|| typeof tileY !== "number"
			|| typeof tileSize !== "number"
			|| typeof surfaceName !== "string"
		) {
			if (logMissing && !this.warnedMissingConfig) {
				this.logger.warn("Missing gridworld boundary config; skipping boundary setup.");
				this.warnedMissingConfig = true;
			}
			return null;
		}

		return {
			tileX,
			tileY,
			tileSize,
			surfaceName,
		};
	}

	private isPathworld(): boolean {
		return this.instance.config.get("instance.name") === "pathworld";
	}

	private async sendBoundaryConfig(logMissing: boolean) {
		if (this.isPathworld()) {
			return;
		}
		const config = this.getBoundaryConfig(logMissing);
		if (!config) {
			return;
		}
		const escapedSurfaceName = lib.escapeString(config.surfaceName);
		await this.sendRcon(
			`/sc gridworld.set_config({tile_x = ${config.tileX}, tile_y = ${config.tileY}, tile_size = ${config.tileSize}, surface_name = "${escapedSurfaceName}"})`,
		);
	}

	async onInstanceConfigFieldChanged(field: string) {
		if (!field.startsWith("gridworld.")) {
			return;
		}
		if (
			field !== "gridworld.tile_x"
			&& field !== "gridworld.tile_y"
			&& field !== "gridworld.tile_size"
			&& field !== "gridworld.surface_name"
		) {
			return;
		}
		await this.sendBoundaryConfig(false);
	}

	async handleGridworldSyncTileAreas(event: messages.GridworldSyncTileAreas) {
		const tilesJson = lib.escapeString(JSON.stringify(event.tiles));
		await this.sendRcon(`/sc gridworld.sync_tile_areas('${tilesJson}')`);
	}

	async onStart() {
		if (this.isPathworld()) {
			await this.sendRcon("/sc gridworld.set_pathworld()");
		} else {
			await this.sendBoundaryConfig(true);
		}
	}

	private async handleRailEntitiesIpc(data: RailEntitiesIPC) {
		const instanceId = this.instance.config.get("instance.id") as number;
		this.logger.info(`[gridworld] rail IPC received: tile=${data.tile_x},${data.tile_y} entities=${data.entities?.length ?? 0} — forwarding to controller`);
		this.instance.sendTo("controller", new messages.GridworldSyncRailEntities(
			instanceId,
			data.tile_x,
			data.tile_y,
			data.tile_size,
			data.entities,
		));
	}

	async handleGridworldApplyRailEntities(event: messages.GridworldApplyRailEntities) {
		this.logger.info(`[gridworld] apply_rail_entities received: tile=${event.tileX},${event.tileY} entities=${event.entities?.length ?? 0}`);
		const json = lib.escapeString(JSON.stringify({
			tile_x:    event.tileX,
			tile_y:    event.tileY,
			tile_size: event.tileSize,
			entities:  event.entities,
		}));
		await this.sendRcon(`/sc gridworld.apply_rail_entities('${json}')`);
	}
}
