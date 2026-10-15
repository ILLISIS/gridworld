-- Pushback (SP2 spec §12.5): mech armor's flying collision mask is trigger_target only, so UE's ue-barrier never
-- stops a flying character past the edge or corner prompt. A character more than core.PUSHBACK_MARGIN outside the
-- tile on either axis is teleported to a free spot near the clamp point, which itself sits exactly PUSHBACK_MARGIN
-- out on that axis, never inside (owner ruling, 2026-10-04: "clamp at 5.5"); the prompts still fire first, so this
-- is a backstop, not a replacement for either. Vehicles are left alone (the owner's ruling).
local core = require("modules/gridworld/tile_core")
local tile = require("modules/gridworld/tile")

local pushback = {}
--- §12.5: rate limit for the pushed_back log line, per player; a 60-tick window, as tile.lua's own per-player
--- text throttle uses (not tile.limited's 3600-tick window, which is for rarer anomalies).
local LOG_WINDOW = 60

--- §12.5: character (a player's or a bare one, for tests with no connected player) more than PUSHBACK_MARGIN outside
--- its surface's tile (surfaces spec §10: the character's own surface's record; none on a platform or any other
--- unrecorded surface) on either axis is teleported to a free spot near the clamped point, or, with none (water: only a
--- flyer gets this far out), to the clamped point itself (playtest 2026-10-11 #5: giving up let a flyer keep going).
--- Returns whether it moved; false when it was close enough to leave alone, or when the teleport itself was refused.
function pushback.push(character)
	local s = storage.gridworld
	local t = s.configured and s.tiles[character.surface.name]
	if not t then
		return false
	end
	local p = character.position
	local cx, cy = core.push_target(t, p.x, p.y, core.PUSHBACK_MARGIN)
	if not cx then
		return false
	end
	local pos = character.surface.find_non_colliding_position("character", { cx, cy }, 8, 0.5)
	local key = character.player and character.player.name or ("entity:" .. tostring(character.unit_number))
	local phase = pos and "pushed_back" or "push_over_water"
	pos = pos or { x = cx, y = cy }
	local moved = character.teleport(pos)
	if not moved then
		tile.limited("push_fail:" .. key, "gw.player", "push_failed", "warn", nil, { player = key, surface = t.surface, x = p.x, y = p.y })
	elseif core.allow(storage.gridworld.limits, "push:" .. key, game.tick, LOG_WINDOW) then
		tile.emit("gw.player", phase, "info", nil,
			{ player = key, surface = t.surface, from = { x = p.x, y = p.y }, to = { x = pos.x, y = pos.y } })
	end
	return moved
end

--- §12.5: a player not in a vehicle, with a character, is checked on every move; no per-tick handler needed. The
--- character entity is always the physical body (unaffected by remote view), so push() already reads physical
--- position and surface by reading the character's.
function pushback.on_player_changed_position(event)
	local player = game.get_player(event.player_index)
	if player and not player.physical_vehicle and player.character then
		pushback.push(player.character)
	end
end

return pushback
