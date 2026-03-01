local clusterio_api = require("modules/clusterio/api")

local gridworld = {
	events = {},
	on_nth_tick = {},
}

local RAIL_TYPES = {
	["straight-rail"] = true,
	["curved-rail-a"] = true,
	["curved-rail-b"] = true,
	["half-diagonal-rail"] = true,
	["legacy-straight-rail"] = true,
	["legacy-curved-rail"] = true,
	["rail-signal"] = true,
	["rail-chain-signal"] = true,
	["train-stop"] = true,
	-- todo: add elevated_rail entities
}

-- Collect all rail entities within this tile's bounds and send them to the host via IPC.
-- Called periodically via on_nth_tick on normal (non-pathworld) tile instances.
local function collect_and_send_rail_entities()
	local config = storage.gridworld
	if config == nil or config.is_pathworld then return end
	if config.bounds == nil then return end

	local results = {}
	for _, surface in pairs(game.surfaces) do
		local entities = surface.find_entities_filtered {
			area = {
				left_top     = { x = config.bounds.min_x, y = config.bounds.min_y },
				right_bottom = { x = config.bounds.max_x, y = config.bounds.max_y },
			},
		}
		for _, entity in ipairs(entities) do
			if entity.valid and RAIL_TYPES[entity.type] and entity.type ~= "entity-ghost" then
				local entry = {
					name      = entity.name,
					type      = entity.type,
					surface   = surface.name,
					x         = entity.position.x,
					y         = entity.position.y,
					direction = entity.direction,
				}
				if entity.type == "train-stop" then
					entry.stopName   = entity.backer_name
					entry.priority   = entity.train_stop_priority
					local limit = entity.trains_limit
					entry.trainLimit = limit
					entry.trainCount = entity.trains_count
				end
				results[#results + 1] = entry
			end
		end
	end

	clusterio_api.send_json("gridworld:rail_entities", {
		tile_x    = config.tile_x,
		tile_y    = config.tile_y,
		tile_size = config.tile_size,
		entities  = results,
	})
end

-- Apply a set of rail entities sent from a tile instance onto this pathworld surface.
-- Diffs against existing entities: removes those no longer present, creates new ones,
-- updates train-stop properties on existing ones.
---@param json string JSON object with tile_x, tile_y, tile_size, entities[]
function gridworld.apply_rail_entities(json)
	local data = helpers.json_to_table(json) --[[@as {tile_x:number,tile_y:number,tile_size:number,entities:table[]}]]
	if data == nil then
		log("[gridworld] apply_rail_entities: failed to parse JSON")
		return
	end
	if data.tile_x == nil or data.tile_y == nil or data.tile_size == nil then
		log("[gridworld] apply_rail_entities: missing tile_x/tile_y/tile_size in payload")
		return
	end

	local half = data.tile_size / 2
	local center_x = data.tile_x * data.tile_size
	local center_y = data.tile_y * data.tile_size
	local area = {
		left_top     = { x = center_x - half, y = center_y - half },
		right_bottom = { x = center_x + half, y = center_y + half },
	}

	-- Build a lookup key for each source entity.
	local function entity_key(e)
		return (e.surface or "nauvis") .. ":" .. e.x .. "," .. e.y .. "," .. e.direction .. "," .. e.name
	end

	-- Index source entities by key.
	local source_map = {}
	for _, e in ipairs(data.entities) do
		source_map[entity_key(e)] = e
	end

	-- Walk existing pathworld entities in the tile area.
	for _, surface in pairs(game.surfaces) do
		local existing = surface.find_entities_filtered { area = area }
		for _, entity in ipairs(existing) do
			if entity.valid and RAIL_TYPES[entity.type] then
				local key = surface.name .. ":" .. entity.position.x .. "," .. entity.position.y .. "," .. entity.direction .. "," .. entity.name
				local src = source_map[key]
				if src == nil then
					-- No longer present in source tile — remove.
					entity.destroy()
				else
					-- Entity matches — update train-stop properties if applicable.
					if entity.type == "train-stop" then
						if src.stopName ~= nil then entity.backer_name = src.stopName end
						if src.priority ~= nil then entity.train_stop_priority = src.priority end
						if src.trainLimit == nil then
							-- nil in source means unlimited
							entity.trains_limit = nil
						else
							-- Clamp: available capacity = limit - current trains on source
							local count = src.trainCount or 0
							entity.trains_limit = math.max(0, src.trainLimit - count)
						end
					end
					-- Mark as handled so we don't create a duplicate.
					source_map[key] = nil
				end
			end
		end
	end

	-- Create entities that are in the source but not yet on the pathworld.
	local created = 0
	local failed = 0
	for _, src in pairs(source_map) do
		local surface = game.surfaces[src.surface] or game.surfaces["nauvis"]
		if surface then
			local ok, err = pcall(function()
				surface.create_entity {
					name      = src.name,
					position  = { x = src.x, y = src.y },
					direction = src.direction,
					force     = game.forces.player,
				}
			end)
			if ok then
				created = created + 1
			else
				failed = failed + 1
				log("[gridworld] apply_rail_entities: failed to create " .. src.name .. " at " .. src.x .. "," .. src.y .. ": " .. tostring(err))
			end
		end
	end
	log("[gridworld] apply_rail_entities: tile=" .. data.tile_x .. "," .. data.tile_y .. " created=" .. created .. " failed=" .. failed)
end

local function ensure_storage()
	if storage.gridworld == nil then
		storage.gridworld = {
			tile_x = nil,
			tile_y = nil,
			tile_size = nil,
			surface_name = nil,
			bounds = nil,
			is_pathworld = false,
		}
	end
end

local function update_bounds()
	local config = storage.gridworld
	if config.tile_x == nil or config.tile_y == nil or config.tile_size == nil then
		config.bounds = nil
		return
	end
	local half = config.tile_size / 2
	local center_x = config.tile_x * config.tile_size
	local center_y = config.tile_y * config.tile_size
	config.bounds = {
		min_x = center_x - half,
		max_x = center_x + half,
		min_y = center_y - half,
		max_y = center_y + half,
	}
end

function gridworld.set_config(config)
	if config == nil then
		return
	end
	ensure_storage()
	storage.gridworld.tile_x = config.tile_x
	storage.gridworld.tile_y = config.tile_y
	storage.gridworld.tile_size = config.tile_size
	storage.gridworld.surface_name = config.surface_name
	update_bounds()
end

function gridworld.set_pathworld()
	ensure_storage()
	storage.gridworld.is_pathworld = true
	log("[gridworld] this instance is pathworld; on_chunk_generated will clear entities and decoratives")
end

--- Called on the pathworld instance via RCON to generate and chart chunks
--- for all known gridworld tile areas.
---@param json string JSON array of {minX, maxX, minY, maxY, surfaceName} objects
function gridworld.sync_tile_areas(json)
	local tiles = helpers.json_to_table(json) --[[@as {minX:number,maxX:number,minY:number,maxY:number,surfaceName:string}[] ]]
	if tiles == nil then
		log("[gridworld] sync_tile_areas: failed to parse JSON")
		return
	end
	for _, tile in ipairs(tiles) do
		local surface = game.surfaces[tile.surfaceName]
		if surface == nil then
			log("[gridworld] sync_tile_areas: surface not found: " .. tostring(tile.surfaceName))
			goto continue
		end
		local chunk_size = 32
		local cx_min = math.floor(tile.minX / chunk_size)
		local cx_max = math.floor((tile.maxX - 1) / chunk_size)
		local cy_min = math.floor(tile.minY / chunk_size)
		local cy_max = math.floor((tile.maxY - 1) / chunk_size)
		for cx = cx_min, cx_max do
			for cy = cy_min, cy_max do
				surface.request_to_generate_chunks({ x = cx * chunk_size, y = cy * chunk_size }, 0)
			end
		end
		-- Entity/decorative removal is handled by on_chunk_generated in pathworld mode.
		game.forces.player.chart(surface, {
			left_top     = { x = tile.minX, y = tile.minY },
			right_bottom = { x = tile.maxX, y = tile.maxY },
		})
		::continue::
	end
end

local function is_outside_bounds(position, bounds)
	return position.x < bounds.min_x
		or position.x > bounds.max_x
		or position.y < bounds.min_y
		or position.y > bounds.max_y
end

local function should_check_entity(entity)
	if entity == nil or not entity.valid then
		return false
	end
	local config = storage.gridworld
	if config == nil or config.bounds == nil then
		return false
	end
	if config.surface_name and entity.surface and entity.surface.name ~= config.surface_name then
		return false
	end
	if entity.type == "character" then
		return false
	end
	return true
end

local function destroy_if_outside(entity)
	if not should_check_entity(entity) then
		return
	end
	if is_outside_bounds(entity.position, storage.gridworld.bounds) then
		entity.destroy()
	end
end

gridworld.events[clusterio_api.events.on_server_startup] = function(_event)
	ensure_storage()
	update_bounds()
end

gridworld.on_nth_tick[900] = collect_and_send_rail_entities

gridworld.events[defines.events.on_entity_spawned] = function(event)
	destroy_if_outside(event.entity)
end

gridworld.events[defines.events.on_biter_base_built] = function(event)
	destroy_if_outside(event.entity)
end

gridworld.events[defines.events.on_built_entity] = function(event)
	destroy_if_outside(event.entity)
end

gridworld.events[defines.events.on_robot_built_entity] = function(event)
	destroy_if_outside(event.entity)
end

gridworld.events[defines.events.script_raised_built] = function(event)
	destroy_if_outside(event.entity)
end

gridworld.events[defines.events.script_raised_revive] = function(event)
	destroy_if_outside(event.entity)
end

gridworld.events[defines.events.on_chunk_generated] = function(event)
	if storage.gridworld == nil then
		return
	end
	local surface = event.surface
	local config = storage.gridworld
	local area = event.area

	if config.is_pathworld then
		local entities = surface.find_entities_filtered { area = area }
		for _, entity in ipairs(entities) do
			if entity.valid and entity.type ~= "character" and not RAIL_TYPES[entity.type] then
				entity.destroy()
			end
		end
		surface.destroy_decoratives { area = area }
		return
	end

	-- Normal tile mode: destroy entities outside this tile's bounds.
	if config.bounds == nil then
		return
	end
	if config.surface_name and surface.name ~= config.surface_name then
		return
	end
	local bounds = config.bounds
	if area.left_top.x >= bounds.min_x
		and area.right_bottom.x <= bounds.max_x
		and area.left_top.y >= bounds.min_y
		and area.right_bottom.y <= bounds.max_y
	then
		return
	end

	local entities = surface.find_entities_filtered { area = area }
	for _, entity in ipairs(entities) do
		if entity.valid and entity.type ~= "character" then
			if is_outside_bounds(entity.position, bounds) then
				entity.destroy()
			end
		end
	end
end

return gridworld
