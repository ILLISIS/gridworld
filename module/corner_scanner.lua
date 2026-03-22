local clusterio_api = require("modules/clusterio/api")
local universal_serializer = require("modules/universal_edges/universal_serializer/universal_serializer")

local corner_scanner = {}

local CORNER_SCAN_PADDING = 6
local ENTITY_TYPES = {"character", "spider-vehicle", "car"} -- tanks are type "car" in Factorio

-- Corner directions mapped to scan area quadrants in the gap zone past both tile boundaries
local CORNERS = {
	ne = { bounds_fn = function(b) return {{b.max_x, b.min_y - CORNER_SCAN_PADDING}, {b.max_x + CORNER_SCAN_PADDING, b.min_y}} end },
	se = { bounds_fn = function(b) return {{b.max_x, b.max_y}, {b.max_x + CORNER_SCAN_PADDING, b.max_y + CORNER_SCAN_PADDING}} end },
	sw = { bounds_fn = function(b) return {{b.min_x - CORNER_SCAN_PADDING, b.max_y}, {b.min_x, b.max_y + CORNER_SCAN_PADDING}} end },
	nw = { bounds_fn = function(b) return {{b.min_x - CORNER_SCAN_PADDING, b.min_y - CORNER_SCAN_PADDING}, {b.min_x, b.min_y}} end },
}

function corner_scanner.poll_corners()
	local config = storage.gridworld
	if config == nil or config.bounds == nil then
		return
	end
	if not config.corner_neighbors then
		return
	end
	local surface_name = config.surface_name
	if not surface_name then
		return
	end
	local surface = game.surfaces[surface_name]
	if not surface then
		return
	end

	for corner_name, corner_def in pairs(CORNERS) do
		local neighbor_id = config.corner_neighbors[corner_name]
		if neighbor_id then
			local scan_area = corner_def.bounds_fn(config.bounds)
			local entities = surface.find_entities_filtered{
				type = ENTITY_TYPES,
				area = scan_area,
			}
			for _, entity in ipairs(entities) do
				if entity.valid then
					corner_scanner.handle_corner_entity(entity, corner_name)
				end
			end
		end
	end
end

---@param entity LuaEntity
---@param corner string
function corner_scanner.handle_corner_entity(entity, corner)
	if entity.type == "character" then
		if entity.player then
			local waiting = storage.gridworld.players_waiting_to_leave_diagonal
			if not waiting[entity.player.name] then
				waiting[entity.player.name] = {
					corner = corner,
					world_position = {entity.position.x, entity.position.y},
				}
				clusterio_api.send_json("gridworld:corner_teleport_player", {
					player_name = entity.player.name,
					corner = corner,
					world_position = {entity.position.x, entity.position.y},
				})
			end
		end
	elseif entity.type == "spider-vehicle" or entity.type == "car" then
		local driver_name = nil
		local passenger_name = nil
		local driver = entity.get_driver()
		if driver and driver.player then
			driver_name = driver.player.name
			storage.gridworld.players_waiting_to_leave_diagonal[driver_name] = {
				corner = corner,
				world_position = {entity.position.x, entity.position.y},
			}
			clusterio_api.send_json("gridworld:corner_teleport_player", {
				player_name = driver_name,
				corner = corner,
				world_position = {entity.position.x, entity.position.y},
			})
		end
		local passenger = entity.get_passenger()
		if passenger and passenger.player then
			passenger_name = passenger.player.name
			storage.gridworld.players_waiting_to_leave_diagonal[passenger_name] = {
				corner = corner,
				world_position = {entity.position.x, entity.position.y},
			}
			clusterio_api.send_json("gridworld:corner_teleport_player", {
				player_name = passenger_name,
				corner = corner,
				world_position = {entity.position.x, entity.position.y},
			})
		end

		local world_position = {entity.position.x, entity.position.y}
		local serialized = universal_serializer.LuaEntity.serialize(entity)
		entity.destroy{raise_destroy = true}

		-- Clear waiting entries so on_player_left_game doesn't send duplicate player transfers
		local waiting = storage.gridworld.players_waiting_to_leave_diagonal
		if driver_name then waiting[driver_name] = nil end
		if passenger_name then waiting[passenger_name] = nil end

		clusterio_api.send_json("gridworld:corner_entity_transfer", {
			corner = corner,
			entity_transfers = {
				{
					type = "vehicle",
					world_position = world_position,
					serialized_entity = serialized,
					driver_name = driver_name,
					passenger_name = passenger_name,
				},
			},
		})
	end
end

---@param event EventData.on_player_left_game
function corner_scanner.on_player_left_game(event)
	local player = game.get_player(event.player_index)
	if player == nil then
		return
	end
	local waiting = storage.gridworld.players_waiting_to_leave_diagonal
	if not waiting[player.name] then
		return
	end
	local leave = waiting[player.name]
	waiting[player.name] = nil

	clusterio_api.send_json("gridworld:corner_entity_transfer", {
		corner = leave.corner,
		entity_transfers = {
			{
				type = "player",
				player_name = player.name,
				world_position = leave.world_position,
			},
		},
	})
end

---@param event EventData.on_player_joined_game
function corner_scanner.on_player_joined_game(event)
	local player = game.get_player(event.player_index)
	if player == nil then
		return
	end
	local waiting = storage.gridworld.players_waiting_to_join_diagonal
	if not waiting[player.name] then
		return
	end
	local join = waiting[player.name]
	waiting[player.name] = nil
	player.teleport({join.world_position[1], join.world_position[2]})

	if storage.gridworld.diagonal_vehicle_drivers and storage.gridworld.diagonal_vehicle_drivers[player.name] then
		local entity = storage.gridworld.diagonal_vehicle_drivers[player.name]
		if entity.valid then
			entity.set_driver(player)
		end
		storage.gridworld.diagonal_vehicle_drivers[player.name] = nil
	end
	if storage.gridworld.diagonal_vehicle_passengers and storage.gridworld.diagonal_vehicle_passengers[player.name] then
		local entity = storage.gridworld.diagonal_vehicle_passengers[player.name]
		if entity.valid then
			entity.set_passenger(player)
		end
		storage.gridworld.diagonal_vehicle_passengers[player.name] = nil
	end
end

return corner_scanner
