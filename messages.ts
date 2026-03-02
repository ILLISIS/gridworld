import { plainJson } from "@clusterio/lib";
import { Type, type Static } from "@sinclair/typebox";

const GridworldTile = Type.Object({
	x: Type.Number(),
	y: Type.Number(),
	instanceId: Type.Number(),
	saveName: Type.String(),
	createdAtMs: Type.Number(),
});

export type GridworldTile = Static<typeof GridworldTile>;

export const GridworldStateResponse = Type.Object({
	tiles: Type.Array(GridworldTile),
	tileSize: Type.Number(),
	initialTile: Type.Object({
		x: Type.Number(),
		y: Type.Number(),
	}),
	mapExchangeError: Type.Union([Type.String(), Type.Null()]),
});

export type GridworldStateResponse = Static<typeof GridworldStateResponse>;

export const GridworldStateValue = Type.Intersect([
	Type.Object({
		id: Type.Literal("state"),
		updatedAtMs: Type.Number(),
		isDeleted: Type.Boolean(),
	}),
	GridworldStateResponse,
]);

export type GridworldStateValue = Static<typeof GridworldStateValue>;

export class GridworldStateUpdate {
	declare ["constructor"]: typeof GridworldStateUpdate;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static plugin = "gridworld" as const;
	static permission = "gridworld.view" as const;

	constructor(public updates: GridworldStateValue[]) { }

	static jsonSchema = Type.Object({
		updates: Type.Array(GridworldStateValue),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.updates);
	}
}

export class GridworldStateRequest {
	declare ["constructor"]: typeof GridworldStateRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "gridworld" as const;
	static permission = "gridworld.view" as const;

	static jsonSchema = Type.Object({});
	static Response = plainJson(GridworldStateResponse);

	static fromJSON() {
		return new this();
	}
}

export class GridworldCreateRequest {
	declare ["constructor"]: typeof GridworldCreateRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "gridworld" as const;
	static permission = "gridworld.manage" as const;

	static jsonSchema = Type.Object({});
	static Response = plainJson(GridworldStateResponse);

	static fromJSON() {
		return new this();
	}
}

export class GridworldDeleteRequest {
	declare ["constructor"]: typeof GridworldDeleteRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static plugin = "gridworld" as const;
	static permission = "gridworld.manage" as const;

	static jsonSchema = Type.Object({});
	static Response = plainJson(GridworldStateResponse);

	static fromJSON() {
		return new this();
	}
}

export class GridworldSyncTileAreas {
	declare ["constructor"]: typeof GridworldSyncTileAreas;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "instance" as const;
	static plugin = "gridworld" as const;

	constructor(
		public tiles: Array<{
			minX: number;
			maxX: number;
			minY: number;
			maxY: number;
			surfaceName: string;
		}>,
	) { }

	static jsonSchema = Type.Object({
		tiles: Type.Array(Type.Object({
			minX: Type.Number(),
			maxX: Type.Number(),
			minY: Type.Number(),
			maxY: Type.Number(),
			surfaceName: Type.String(),
		})),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.tiles);
	}
}

const RailEntity = Type.Object({
	name: Type.String(),
	type: Type.String(),
	surface: Type.String(),
	x: Type.Number(),
	y: Type.Number(),
	direction: Type.Number(),
	// train-stop fields
	stopName: Type.Optional(Type.String()),
	color: Type.Optional(Type.Object({
		r: Type.Number(),
		g: Type.Number(),
		b: Type.Number(),
		a: Type.Number(),
	})),
	priority: Type.Optional(Type.Number()),
	trainLimit: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	trainCount: Type.Optional(Type.Number()),
});

export type RailEntity = Static<typeof RailEntity>;

export class GridworldSyncRailEntities {
	declare ["constructor"]: typeof GridworldSyncRailEntities;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "gridworld" as const;

	constructor(
		public instanceId: number,
		public tileX: number,
		public tileY: number,
		public tileSize: number,
		public entities: RailEntity[],
	) { }

	static jsonSchema = Type.Object({
		instanceId: Type.Number(),
		tileX: Type.Number(),
		tileY: Type.Number(),
		tileSize: Type.Number(),
		entities: Type.Array(RailEntity),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId, json.tileX, json.tileY, json.tileSize, json.entities);
	}
}

export class GridworldApplyRailEntities {
	declare ["constructor"]: typeof GridworldApplyRailEntities;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "instance" as const;
	static plugin = "gridworld" as const;

	constructor(
		public tileX: number,
		public tileY: number,
		public tileSize: number,
		public entities: RailEntity[],
	) { }

	static jsonSchema = Type.Object({
		tileX: Type.Number(),
		tileY: Type.Number(),
		tileSize: Type.Number(),
		entities: Type.Array(RailEntity),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.tileX, json.tileY, json.tileSize, json.entities);
	}
}

const UeStop = Type.Object({
	surface: Type.String(),
	x: Type.Number(),
	y: Type.Number(),
	direction: Type.Number(),
	stopName: Type.Optional(Type.String()),
});

export type UeStop = Static<typeof UeStop>;

export class GridworldSyncUeStops {
	declare ["constructor"]: typeof GridworldSyncUeStops;
	static type = "event" as const;
	static src = "instance" as const;
	static dst = "controller" as const;
	static plugin = "gridworld" as const;

	constructor(
		public instanceId: number,
		public tileX: number,
		public tileY: number,
		public stops: UeStop[],
	) { }

	static jsonSchema = Type.Object({
		instanceId: Type.Number(),
		tileX: Type.Number(),
		tileY: Type.Number(),
		stops: Type.Array(UeStop),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.instanceId, json.tileX, json.tileY, json.stops);
	}
}

export class GridworldApplyUeStops {
	declare ["constructor"]: typeof GridworldApplyUeStops;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "instance" as const;
	static plugin = "gridworld" as const;

	constructor(
		public tileX: number,
		public tileY: number,
		public stops: UeStop[],
	) { }

	static jsonSchema = Type.Object({
		tileX: Type.Number(),
		tileY: Type.Number(),
		stops: Type.Array(UeStop),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.tileX, json.tileY, json.stops);
	}
}
