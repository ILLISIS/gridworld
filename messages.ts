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
