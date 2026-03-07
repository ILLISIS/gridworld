local clusterio_api = require("modules/clusterio/api")

local tpm = {}

local train_state_names = {}
for name, value in pairs(defines.train_state) do
    train_state_names[value] = name
end

--[[
    event handler
    request train path
    find train path
    return train path
    apply train path
]]

function tpm.on_train_changed_state(event)
    local state = event.old_state
    local LuaTrain = event.train

    -- only request a new path when the train was previously waiting at a station
    if state ~= defines.train_state.wait_station then return end
    tpm.request_train_path(LuaTrain)
end

function tpm.request_train_path(LuaTrain)
    log("tpm:request_train_path")

    -- Implementation for requesting a train path
    -- skip if train is already in manual mode (e.g., request already in progress)
    if LuaTrain.manual_mode then return end
    -- get current train schedule target
    local schedule = LuaTrain.schedule
    local current_record = schedule and schedule.records and schedule.records[schedule.current]
    if current_record and current_record.temporary then return end
    if not current_record or not current_record.station then return end
    local destination = current_record.station
    -- add request to globals
    storage.gridworld.train_path_requests[LuaTrain.front_stock.unit_number] = {
        LuaTrain = LuaTrain,
        is_pathing = true,
    }
    -- set manual mode for train to stop it from moving while we find a path
    LuaTrain.manual_mode = true
    local pos = LuaTrain.front_stock.position
    local path_request = {
        id = LuaTrain.front_stock.unit_number,
        surface = LuaTrain.front_stock.surface.name,
        position = { x = pos.x, y = pos.y },
        direction = LuaTrain.front_stock.direction,
        destination = destination,
    }
    -- add status text to train
    local render = rendering.draw_text{
        text = "Requesting path",
        surface = LuaTrain.front_stock.surface,
        target = LuaTrain.front_stock,
        color = { r = 1, g = 1, b = 1, a = 1 },
        blink_interval = 30,
        alignment = "center",
        vertical_alignment = "middle",
    }
    storage.gridworld.train_path_requests[LuaTrain.front_stock.unit_number].render = render
    -- send the request to the controller
    clusterio_api.send_json("gridworld:request_train_path", path_request)
end

function tpm.find_train_path(json)
    log("tpm:find_train_path")

    -- Implementation for finding a train path
    -- convert json
    local path_request = helpers.json_to_table(json)
    if not path_request then return end
    local path = {
        id = path_request.id,
        path = {},
        source_instance_id = path_request.sourceInstanceId,
    }
    -- find stations
    local surface = game.surfaces[path_request.surface]
    if not surface then
        game.print("Surface not found: " .. path_request.surface)
        log("Surface not found: " .. path_request.surface)
        tpm.return_train_path_result(path) -- empty path
        return
    end
    local all_stops = surface.find_entities_filtered{ type = "train-stop" }
    -- filter stations
    local goals = {}
    for _, stop in ipairs(all_stops) do
        if stop.valid and stop.backer_name == path_request.destination and stop.trains_limit ~= 0 then
            table.insert(goals, { train_stop = stop })
        end
    end
    if #goals == 0 then
        game.print("No valid train stops found for destination: " .. path_request.destination)
        log("No valid train stops found for destination: " .. path_request.destination)
        tpm.return_train_path_result(path) -- empty path
        return
    end
    -- find starting rail
    local start_rails = surface.find_entities_filtered{
        type = "straight-rail",
        position = path_request.position,
        radius = 2,
    }
    if #start_rails == 0 then
        game.print("No starting rail found near position: " .. path_request.position.x .. ", " .. path_request.position.y)
        log("No starting rail found near position: " .. path_request.position.x .. ", " .. path_request.position.y)
        tpm.return_train_path_result(path)
        return
    end
    local start_rail = start_rails[1]
    -- render line from source to each goal station
    local ttl = 300 -- 5 seconds at 60 ticks/s
    for _, goal in ipairs(goals) do
        rendering.draw_line{
            color = { r = 0.5, g = 0.5, b = 0.5, a = 0.5 },
            width = 2,
            from = start_rail,
            to = goal.train_stop,
            surface = surface,
            time_to_live = ttl,
            draw_on_ground = true,
        }
    end
    -- find path
    local result = game.train_manager.request_train_path{
        starts = {
            { rail = start_rail, direction = defines.rail_direction.front },
            { rail = start_rail, direction = defines.rail_direction.back },
        },
        goals = goals,
        return_path = true,
    }
    -- highlight the chosen goal
    if result.found_path and result.goal_index then
        rendering.draw_line{
            color = { r = 0, g = 1, b = 0, a = 0.8 },
            width = 4,
            from = start_rail,
            to = goals[result.goal_index].train_stop,
            surface = surface,
            time_to_live = ttl,
            draw_on_ground = true,
        }
    end
    -- iterate path for ue_source_trainstop
    if not result.found_path or not result.path then
        game.print("No path found for train id: " .. path_request.id)
        log("No path found for train id: " .. path_request.id)
        tpm.return_train_path_result(path) -- empty path
        return
    end
    local seen = {}
    for _, rail in ipairs(result.path) do
        if rail.valid then
            for _, rail_dir in ipairs({ defines.rail_direction.front, defines.rail_direction.back }) do
                local stop = rail.get_rail_segment_stop(rail_dir)
                if stop and stop.valid and stop.name == "ue_source_trainstop" and not seen[stop.backer_name] then
                    seen[stop.backer_name] = true
                    table.insert(path.path, stop.backer_name)
                end
            end
        end
    end
    -- return path to controller
    tpm.return_train_path_result(path)
end

function tpm.return_train_path_result(path)
    log("tpm:return_train_path_result")

    -- Implementation for returning a train path
    -- send result to controller
    clusterio_api.send_json("gridworld:return_train_path", path)
end

function tpm.apply_train_path_result(json)
    log("tpm:apply_train_path_result")

    -- Implementation for applying a train path
    -- convert json
    local path_result = helpers.json_to_table(json)
    if not path_result then return end
    -- apply the path to the train schedule
    if not storage.gridworld.train_path_requests[path_result.id] then
        game.print("No pending train path request found for train id: " .. path_result.id)
        log("No pending train path request found for train id: " .. path_result.id)
        return
    end
    local LuaTrain = storage.gridworld.train_path_requests[path_result.id].LuaTrain
    if #path_result.path == 0 then
        -- no path found, re-enable train and let it retry naturally
        LuaTrain.manual_mode = false
        storage.gridworld.train_path_requests[path_result.id].render.destroy()
        storage.gridworld.train_path_requests[path_result.id] = nil
        return
    end

    -- insert ue_source_trainstop names as temporary schedule records before the current destination
    local schedule = LuaTrain.schedule or { current = 1, records = {} }
    local insert_index = schedule.current
    log(serpent.block(path_result.path))
    for i, stop_name in ipairs(path_result.path) do
        table.insert(schedule.records, insert_index + i - 1, {
            station = stop_name,
            temporary = true,
        })
    end
    -- point to the first temporary stop so the train paths there
    schedule.current = insert_index
    LuaTrain.schedule = schedule
    LuaTrain.manual_mode = false
    -- remove train status text
    storage.gridworld.train_path_requests[LuaTrain.front_stock.unit_number].render.destroy()
    -- remove train from storage flag
    storage.gridworld.train_path_requests[LuaTrain.front_stock.unit_number] = nil
end

return tpm