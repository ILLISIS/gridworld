import * as lib from "@clusterio/lib";
import { BaseInstancePlugin } from "@clusterio/host";
import * as messages from "./messages";

type BoundaryConfig = {
	tileX: number;
	tileY: number;
	tileSize: number;
	surfaceName: string;
};

export class InstancePlugin extends BaseInstancePlugin {
	private warnedMissingConfig = false;

	async init() {
		this.instance.handle(messages.GridworldSyncTileAreas, this.handleGridworldSyncTileAreas.bind(this));
	}

	private getBoundaryConfig(logMissing: boolean): BoundaryConfig | null {
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

	async onStart() {
		if (this.isPathworld()) {
			await this.sendRcon("/sc gridworld.set_pathworld()");
		} else {
			await this.sendBoundaryConfig(true);
		}
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
}
