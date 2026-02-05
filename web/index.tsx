import React, { useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
	BaseWebPlugin,
	ControlContext,
	PageHeader,
	PageLayout,
	notifyErrorHandler,
	useHosts,
} from "@clusterio/web_ui";
import * as lib from "@clusterio/lib";
import { Alert, Button, Popconfirm, Space, Spin } from "antd";

import * as messages from "../messages";
import { GridworldDataSource, type MinimapViewBounds } from "./dataSources/GridworldDataSource";

import "./style.css";

type MinimapModule = {
	CanvasMinimapPage: React.ComponentType<any>;
	GetRawTileRequest: new (...args: any[]) => any;
	GetRawRecipeTileRequest: new (...args: any[]) => any;
	GetChartTagsRequest: new (...args: any[]) => any;
	GetPlayerPathRequest: new (...args: any[]) => any;
};

type EdgeTargetSpec = {
	instanceId: number;
	origin: number[];
	surface: string;
	direction: number;
};

type EdgeConfig = {
	id: string;
	isDeleted: boolean;
	active: boolean;
	length: number;
	source: EdgeTargetSpec;
	target: EdgeTargetSpec;
};

type EdgeSubscriber = {
	subscribe: (handler: (event: unknown, synced: boolean) => void) => () => void;
	getSnapshot: () => readonly [ReadonlyMap<string, EdgeConfig>, boolean];
};

type UniversalEdgesWebPlugin = {
	subscribableEdgeConfigs?: EdgeSubscriber;
};

const EDGE_ID_PREFIX = "gridworld:";
const FULL_CIRCLE = Math.PI * 2;

function GridworldPage() {
	const control = useContext(ControlContext);
	const plugin = control.plugins.get("gridworld") as WebPlugin;
	const [hosts, hostsSynced] = useHosts();
	const [state, setState] = useState<messages.GridworldStateResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [actionBusy, setActionBusy] = useState(false);
	const [minimapModule, setMinimapModule] = useState<MinimapModule | null>(null);
	const [minimapError, setMinimapError] = useState<string | null>(null);
	const [viewBounds, setViewBounds] = useState<MinimapViewBounds | null>(null);
	const [activeSurface, setActiveSurface] = useState("nauvis");
	const hasConnectedHost = useMemo(() => {
		for (const host of hosts.values()) {
			if (host.connected) {
				return true;
			}
		}
		return false;
	}, [hosts]);

	const [gridworldStateSnapshot] = plugin.useGridworldState();
	const subscribedState = gridworldStateSnapshot.get("state") ?? null;
	useEffect(() => {
		if (!subscribedState) {
			return;
		}
		setState(subscribedState);
	}, [subscribedState]);

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
		const minimapPlugin = control.plugins.get("minimap") as { container?: any } | undefined;
		if (!minimapPlugin?.container) {
			setMinimapModule(null);
			setMinimapError("Minimap plugin is not loaded");
			return;
		}
		minimapPlugin.container.get("./web")
			.then((factory: () => MinimapModule) => {
				setMinimapModule(factory());
				setMinimapError(null);
			})
			.catch((err: Error) => {
				setMinimapModule(null);
				setMinimapError(err.message || "Failed to load minimap module");
			});
	}, [control]);

	const minimapRequests = useMemo(() => {
		if (!minimapModule) {
			return null;
		}
		return {
			GetRawTileRequest: minimapModule.GetRawTileRequest,
			GetRawRecipeTileRequest: minimapModule.GetRawRecipeTileRequest,
			GetChartTagsRequest: minimapModule.GetChartTagsRequest,
			GetPlayerPathRequest: minimapModule.GetPlayerPathRequest,
		};
	}, [minimapModule]);

	const handleViewBoundsChange = useCallback((bounds: MinimapViewBounds) => {
		setViewBounds(bounds);
	}, []);

	const handleSurfaceForceChange = useCallback((surface: string, _force: string) => {
		setActiveSurface(surface);
	}, []);

	const universalEdgesPlugin = control.plugins.get("universal_edges") as UniversalEdgesWebPlugin | undefined;
	const edgeSubscriber = universalEdgesPlugin?.subscribableEdgeConfigs;
	const emptyEdgeSnapshot = useMemo(
		() => [new Map<string, EdgeConfig>(), false] as const,
		[],
	);
	const [edgeConfigs] = useSyncExternalStore(
		useCallback((callback) => {
			if (!edgeSubscriber) {
				return () => undefined;
			}
			return edgeSubscriber.subscribe(() => callback());
		}, [edgeSubscriber]),
		useCallback(
			() => edgeSubscriber?.getSnapshot() ?? emptyEdgeSnapshot,
			[edgeSubscriber, emptyEdgeSnapshot],
		),
	);

	const dataSource = useMemo(() => {
		if (!state || !minimapRequests) {
			return null;
		}
		return new GridworldDataSource(
			control,
			state,
			minimapRequests,
			control.plugins.get("minimap") as any,
			{
				onViewBoundsChange: handleViewBoundsChange,
				onSurfaceForceChange: handleSurfaceForceChange,
			},
		);
	}, [control, state, minimapRequests, handleViewBoundsChange, handleSurfaceForceChange]);

	const edgePath = useMemo(() => {
		if (!edgeConfigs || edgeConfigs.size === 0) {
			return "";
		}
		let path = "";
		for (const edge of edgeConfigs.values()) {
			if (edge.isDeleted || !edge.active) {
				continue;
			}
			if (!edge.id.startsWith(EDGE_ID_PREFIX)) {
				continue;
			}
			if (edge.source?.surface && edge.source.surface !== activeSurface) {
				continue;
			}
			const origin = edge.source?.origin;
			if (!origin || origin.length < 2) {
				continue;
			}
			const [x1, y1] = origin;
			if (!Number.isFinite(x1) || !Number.isFinite(y1)) {
				continue;
			}
			if (!Number.isFinite(edge.length)) {
				continue;
			}
			const direction = Number.isFinite(edge.source.direction) ? edge.source.direction : 0;
			const angle = (direction / 16) * FULL_CIRCLE;
			const x2 = x1 + Math.cos(angle) * edge.length;
			const y2 = y1 + Math.sin(angle) * edge.length;
			if (!Number.isFinite(x2) || !Number.isFinite(y2)) {
				continue;
			}
			if (viewBounds) {
				const left = viewBounds.worldLeft;
				const right = viewBounds.worldRight;
				const top = viewBounds.worldTop;
				const bottom = viewBounds.worldBottom;
				if (![left, right, top, bottom].every(Number.isFinite)) {
					continue;
				}
				if (
					(x1 < left && x2 < left)
					|| (x1 > right && x2 > right)
					|| (y1 < top && y2 < top)
					|| (y1 > bottom && y2 > bottom)
				) {
					continue;
				}
			}
			path += `M${x1} ${y1} L${x2} ${y2} `;
		}
		return path.trim();
	}, [edgeConfigs, activeSurface, viewBounds]);

	const edgeViewBox = useMemo(() => {
		if (!viewBounds) {
			return null;
		}
		if (
			![
				viewBounds.worldLeft,
				viewBounds.worldTop,
				viewBounds.worldRight,
				viewBounds.worldBottom,
			].every(Number.isFinite)
		) {
			return null;
		}
		const width = viewBounds.worldRight - viewBounds.worldLeft;
		const height = viewBounds.worldBottom - viewBounds.worldTop;
		if (width <= 0 || height <= 0) {
			return null;
		}
		return `${viewBounds.worldLeft} ${viewBounds.worldTop} ${width} ${height}`;
	}, [viewBounds]);

	const createGridworld = async () => {
		setActionBusy(true);
		try {
			const current = await control.send(new messages.GridworldStateRequest());
			if (current.mapExchangeError) {
				setState(current);
				notifyErrorHandler("Cannot create gridworld")(new Error(current.mapExchangeError));
				return;
			}
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

	const createDisabled = loading || actionBusy || !hasConnectedHost || typeof state?.mapExchangeError === "string";
	const showNoHostWarning = hostsSynced && !hasConnectedHost;
	const tileSizeInvalid = state ? !(state.tileSize > 0 && state.tileSize % 256 === 0) : false;
	const MinimapCanvas = minimapModule?.CanvasMinimapPage;

	return <PageLayout nav={[{ name: "Gridworld" }]}>
		<PageHeader
			title="Gridworld"
			extra={
				<Space>
					<Button onClick={loadState} disabled={loading || actionBusy}>
						Refresh
					</Button>
					<Button type="primary" onClick={createGridworld} loading={actionBusy} disabled={createDisabled}>
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
		{showNoHostWarning && (
			<Alert
				type="warning"
				showIcon
				message="No connected hosts"
				description="Connect a host before creating a gridworld so instances can be assigned."
				style={{ marginBottom: 16 }}
			/>
		)}
		{state?.mapExchangeError && (
			<Alert
				type="warning"
				showIcon
				message="Map exchange string issue"
				description={state.mapExchangeError}
				style={{ marginBottom: 16 }}
			/>
		)}
		{minimapError && (
			<Alert
				type="error"
				showIcon
				message="Minimap module unavailable"
				description={minimapError}
				style={{ marginBottom: 16 }}
			/>
		)}
		{tileSizeInvalid && state && (
			<Alert
				type="error"
				showIcon
				message="Unsupported grid tile size"
				description={`Gridworld tile size (${state.tileSize}) must be a multiple of 256 to render the unified map.`}
				style={{ marginBottom: 16 }}
			/>
		)}
		{!state && <div style={{ padding: 24 }}><Spin size="large" /></div>}
		{state && !MinimapCanvas && !minimapError && (
			<div style={{ padding: 24 }}><Spin size="large" /></div>
		)}
		{state && dataSource && MinimapCanvas && !tileSizeInvalid && (
			<div className="gridworld-map">
				<MinimapCanvas
					dataSource={dataSource}
					title="Gridworld Map"
					showInstanceSelector={false}
					showManageActions={false}
				/>
				{edgeViewBox && edgePath && (
					<svg
						className="gridworld-edge-overlay"
						viewBox={edgeViewBox}
						preserveAspectRatio="none"
						aria-hidden="true"
					>
						<path className="gridworld-edge-path" d={edgePath} />
					</svg>
				)}
			</div>
		)}
	</PageLayout>;
}

export class WebPlugin extends BaseWebPlugin {
	subscribableGridworldState = new lib.EventSubscriber(messages.GridworldStateUpdate, this.control);

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

	useGridworldState() {
		const subscribe = useCallback(
			(callback: () => void) => this.subscribableGridworldState.subscribe(callback),
			[],
		);
		return useSyncExternalStore(subscribe, () => this.subscribableGridworldState.getSnapshot());
	}
}
