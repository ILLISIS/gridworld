import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
	BaseWebPlugin,
	ControlContext,
	PageHeader,
	PageLayout,
	notifyErrorHandler,
} from "@clusterio/web_ui";
import { Alert, Button, Card, Empty, Popconfirm, Space, Spin, Typography } from "antd";

import * as messages from "../messages";

import "./style.css";

const { Text } = Typography;

function GridworldPage() {
	const control = useContext(ControlContext);
	const [state, setState] = useState<messages.GridworldStateResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [actionBusy, setActionBusy] = useState(false);

	const loadState = useCallback(async () => {
		setLoading(true);
		try {
			setState(await control.send(new messages.GridworldStateRequest()));
		} catch (err) {
			notifyErrorHandler("Error loading gridworld state")(err as Error);
		} finally {
			setLoading(false);
		}
	}, [control]);

	useEffect(() => {
		loadState();
	}, [loadState]);

	const createGridworld = async () => {
		setActionBusy(true);
		try {
			setState(await control.send(new messages.GridworldCreateRequest()));
		} catch (err) {
			notifyErrorHandler("Error creating gridworld")(err as Error);
		} finally {
			setActionBusy(false);
		}
	};

	const deleteGridworld = async () => {
		setActionBusy(true);
		try {
			setState(await control.send(new messages.GridworldDeleteRequest()));
		} catch (err) {
			notifyErrorHandler("Error deleting gridworld")(err as Error);
		} finally {
			setActionBusy(false);
		}
	};

	const tiles = state?.tiles ?? [];
	const bounds = useMemo(() => {
		if (!tiles.length) {
			return null;
		}
		let minX = tiles[0].x;
		let maxX = tiles[0].x;
		let minY = tiles[0].y;
		let maxY = tiles[0].y;
		for (const tile of tiles) {
			minX = Math.min(minX, tile.x);
			maxX = Math.max(maxX, tile.x);
			minY = Math.min(minY, tile.y);
			maxY = Math.max(maxY, tile.y);
		}
		return { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
	}, [tiles]);

	const tileMap = useMemo(() => {
		const map = new Map<string, messages.GridworldTile>();
		for (const tile of tiles) {
			map.set(`${tile.x},${tile.y}`, tile);
		}
		return map;
	}, [tiles]);

	const gridCells = useMemo(() => {
		if (!bounds) {
			return [];
		}
		const cells = [];
		for (let y = bounds.maxY; y >= bounds.minY; y -= 1) {
			for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
				const tile = tileMap.get(`${x},${y}`);
				cells.push(
					<div
						key={`${x},${y}`}
						className={`gridworld-cell ${tile ? "tile" : "empty"}`}
						title={tile ? `Tile ${x},${y} (instance ${tile.instanceId})` : `Empty ${x},${y}`}
					>
						<div className="gridworld-cell-title">{x}, {y}</div>
						{tile && <div className="gridworld-cell-sub">Instance {tile.instanceId}</div>}
					</div>,
				);
			}
		}
		return cells;
	}, [bounds, tileMap]);

	return <PageLayout nav={[{ name: "Gridworld" }]}>
		<PageHeader
			title="Gridworld"
			extra={
				<Space>
					<Button onClick={loadState} disabled={loading || actionBusy}>
						Refresh
					</Button>
					<Button type="primary" onClick={createGridworld} loading={actionBusy}>
						Create new gridworld
					</Button>
					<Popconfirm
						title="Delete the entire gridworld?"
						description="This deletes all gridworld instances and edges."
						okText="Delete"
						okButtonProps={{ danger: true }}
						onConfirm={() => deleteGridworld()}
					>
						<Button danger disabled={actionBusy}>
							Delete gridworld
						</Button>
					</Popconfirm>
				</Space>
			}
		/>
		{state?.mapExchangeError && (
			<Alert
				type="warning"
				showIcon
				message="Map exchange string issue"
				description={state.mapExchangeError}
				style={{ marginBottom: 16 }}
			/>
		)}
		<Card className="gridworld-card">
			{loading && !state && <div className="gridworld-loading"><Spin size="large" /></div>}
			{!loading && !tiles.length && <Empty description="No tiles yet" />}
			{!!tiles.length && bounds && (
				<>
					<div className="gridworld-summary">
						<Text>Tiles: {tiles.length}</Text>
						<Text>Bounds: {bounds.minX},{bounds.minY} to {bounds.maxX},{bounds.maxY}</Text>
						<Text>Initial tile: {state?.initialTile.x}, {state?.initialTile.y}</Text>
						<Text>Tile size: {state?.tileSize}</Text>
					</div>
					<div
						className="gridworld-grid"
						style={{ gridTemplateColumns: `repeat(${bounds.width}, var(--gridworld-cell-size))` }}
					>
						{gridCells}
					</div>
				</>
			)}
		</Card>
	</PageLayout>;
}

export class WebPlugin extends BaseWebPlugin {
	async init() {
		this.pages = [
			{
				path: "/gridworld",
				sidebarName: "Gridworld",
				permission: "gridworld.view",
				content: <GridworldPage />,
			},
		];
	}
}
