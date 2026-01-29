import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
	BaseWebPlugin,
	ControlContext,
	PageHeader,
	PageLayout,
	notifyErrorHandler,
	useHosts,
} from "@clusterio/web_ui";
import { Alert, Button, Popconfirm, Space, Spin } from "antd";

import * as messages from "../messages";
import { GridworldDataSource } from "./dataSources/GridworldDataSource";

import "./style.css";

type MinimapModule = {
	CanvasMinimapPage: React.ComponentType<any>;
	GetRawTileRequest: new (...args: any[]) => any;
	GetRawRecipeTileRequest: new (...args: any[]) => any;
	GetChartTagsRequest: new (...args: any[]) => any;
	GetPlayerPathRequest: new (...args: any[]) => any;
};

function GridworldPage() {
	const control = useContext(ControlContext);
	const [hosts, hostsSynced] = useHosts();
	const [state, setState] = useState<messages.GridworldStateResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [actionBusy, setActionBusy] = useState(false);
	const [minimapModule, setMinimapModule] = useState<MinimapModule | null>(null);
	const [minimapError, setMinimapError] = useState<string | null>(null);
	const hasConnectedHost = useMemo(() => {
		for (const host of hosts.values()) {
			if (host.connected) {
				return true;
			}
		}
		return false;
	}, [hosts]);

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

	const dataSource = useMemo(() => {
		if (!state || !minimapRequests) {
			return null;
		}
		return new GridworldDataSource(
			control,
			state,
			minimapRequests,
			control.plugins.get("minimap") as any,
		);
	}, [control, state, minimapRequests]);

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

	const createDisabled = loading || actionBusy || !hasConnectedHost;
	const showNoHostWarning = hostsSynced && !hasConnectedHost;
	const tileSizeInvalid = state ? state.tileSize % 256 !== 0 : false;
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
		{loading && !state && <div style={{ padding: 24 }}><Spin size="large" /></div>}
		{state && !MinimapCanvas && !minimapError && (
			<div style={{ padding: 24 }}><Spin size="large" /></div>
		)}
		{state && dataSource && MinimapCanvas && !tileSizeInvalid && (
			<MinimapCanvas
				dataSource={dataSource}
				title="Gridworld Map"
				showInstanceSelector={false}
				showManageActions={false}
			/>
		)}
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
