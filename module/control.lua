local clusterio_api = require("modules/clusterio/api")

local gridworld = {
	events = {},
	on_nth_tick = {},
}

local function ensure_storage()
	if storage.gridworld == nil then
		storage.gridworld = {
			tile_x = nil,
			tile_y = nil,
			tile_size = nil,
			surface_name = nil,
			bounds = nil,
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
	if storage.gridworld == nil or storage.gridworld.bounds == nil then
		return
	end
	local surface = event.surface
	local config = storage.gridworld
	if config.surface_name and surface.name ~= config.surface_name then
		return
	end
	local bounds = config.bounds
	local area = event.area
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
