local t = require("modules/v2_test/testlib")
local core = require("modules/gridworld/tile_core")
local pushback = require("modules/gridworld/pushback")

-- The shared tile (tile_game_test.lua) is configured at tick 100. This file owns ticks 500-599; no other file's
-- fixed steps land there (a drifting poll from another file may share a tick number, but it touches a different
-- area of the map, never this one).

--- Make an area walkable: grass, and no tree, rock or cliff.
local function land(surface, x1, y1, x2, y2)
	local tiles = {}
	for x = math.floor(x1), math.ceil(x2) - 1 do
		for y = math.floor(y1), math.ceil(y2) - 1 do
			tiles[#tiles + 1] = { name = "grass-1", position = { x, y } }
		end
	end
	surface.set_tiles(tiles)
	for _, e in pairs(surface.find_entities_filtered({ area = { { x1, y1 }, { x2, y2 } }, type = { "tree", "simple-entity", "cliff" } })) do
		e.destroy()
	end
end

t.case("pushback: a character 8 tiles outside is clamped to 5.5 out (never inside); the other axis is unchanged", function(ctx)
	ctx.at(500, function()
		local surface = game.surfaces.nauvis
		local b = storage.gridworld.tiles.nauvis
		local y = b.y1 + 10 -- clear of the other files' areas near the tile's centre row and the south-east corner
		land(surface, b.x2 - 10, y - 10, b.x2 + 10, y + 10)
		local character = surface.create_entity({ name = "character", position = { b.x2 + 8, y }, force = "player" })
		ctx.expect(character ~= nil, "a character")
		if not character then
			return
		end
		ctx.expect(pushback.push(character), "pushed")
		local p = character.position
		ctx.expect(not core.inside(b, p.x, p.y), "never teleported inside: " .. p.x .. ", " .. p.y)
		ctx.expect(math.abs(p.x - (b.x2 + core.PUSHBACK_MARGIN)) < 0.1, "5.5 out on x (within 0.1), got " .. p.x)
		ctx.expect(math.abs(p.y - y) < 0.1, "y untouched (within 0.1), got " .. p.y)
		character.destroy()
	end)
end)

--- Playtest 2026-10-11 #5: over deep water there is no free spot near the clamp point, and push-back used to give up
--- (push_failed), so a flying player kept going outward. Now the character goes to the exact clamp point, on the water.
t.case("pushback: over deep water, a character 8 tiles outside goes to the exact clamp point 5.5 out", function(ctx)
	ctx.expect_ipc("gridworld:out", '"phase":"push_over_water"')
	ctx.at(530, function()
		local surface = game.surfaces.nauvis
		local b = storage.gridworld.tiles.nauvis
		local x = b.x1 + 20 -- the north edge: the other files use the centre row, the west edge and the south-east corner
		land(surface, x - 12, b.y1 - 18, x + 12, b.y1 + 6)
		local water = {}
		for wx = x - 12, x + 11 do
			for y = b.y1 - 18, b.y1 + 5 do
				water[#water + 1] = { name = "deepwater", position = { wx, y } }
			end
		end
		surface.set_tiles(water)
		local character = surface.create_entity({ name = "character", position = { x, b.y1 - 8 }, force = "player" })
		ctx.expect(character ~= nil, "a character")
		if not character then
			return
		end
		ctx.expect(surface.find_non_colliding_position("character", { x, b.y1 - core.PUSHBACK_MARGIN }, 8, 0.5) == nil,
			"setup: no free spot within 8 of the clamp point")
		ctx.expect(pushback.push(character), "pushed")
		local p = character.position
		ctx.expect(math.abs(p.y - (b.y1 - core.PUSHBACK_MARGIN)) < 0.01, "exactly 5.5 out on y, got " .. p.y)
		ctx.expect(math.abs(p.x - x) < 0.01, "x untouched, got " .. p.x)
		character.destroy()
		land(surface, x - 12, b.y1 - 18, x + 12, b.y1 + 6)
	end)
end)

t.case("pushback: a character 3 tiles outside is left untouched", function(ctx)
	ctx.at(510, function()
		local surface = game.surfaces.nauvis
		local b = storage.gridworld.tiles.nauvis
		local y = b.y1 + 20
		land(surface, b.x2 - 10, y - 10, b.x2 + 10, y + 10)
		local character = surface.create_entity({ name = "character", position = { b.x2 + 3, y }, force = "player" })
		ctx.expect(character ~= nil, "a character")
		if not character then
			return
		end
		ctx.expect(not pushback.push(character), "untouched")
		ctx.expect(character.position.x == b.x2 + 3 and character.position.y == y, "stayed put")
		character.destroy()
	end)
end)

t.case("pushback: on Vulcanus, a character 8 tiles outside is clamped on Vulcanus (surfaces spec §10)", function(ctx)
	ctx.at(520, function()
		local surface = game.get_surface("vulcanus")
		local b = storage.gridworld.tiles.vulcanus
		local y = b.y1 + 10
		land(surface, b.x2 - 10, y - 10, b.x2 + 10, y + 10)
		local character = surface.create_entity({ name = "character", position = { b.x2 + 8, y }, force = "player" })
		ctx.expect(character ~= nil, "a character on Vulcanus")
		if not character then
			return
		end
		ctx.expect(pushback.push(character), "pushed")
		ctx.expect(character.surface.name == "vulcanus", "still on Vulcanus")
		ctx.expect(math.abs(character.position.x - (b.x2 + core.PUSHBACK_MARGIN)) < 0.1,
			"5.5 out on x (within 0.1), got " .. character.position.x)
		character.destroy()
	end)
end)
