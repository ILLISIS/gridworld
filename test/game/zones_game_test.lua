local t = require("modules/v2_test/testlib")
local players = require("modules/universal_edges/transports/players")

-- Gridworld's corner zones through UE's crossing (crossing spec §3.2, §7.1): the shared tile is configured at tick 100.

t.case("zones: near a corner, past one line or both, the key is the corner's; an edge strip 9 tiles away is not",
	function(ctx)
	ctx.at(300, function()
		local b = storage.gridworld.tiles.nauvis
		local s = game.surfaces.nauvis
		ctx.expect(players.zone(s.index, "nauvis", b.x2 + 1, b.y2 - 3, nil) == "gridworld:se", "east strip near se")
		ctx.expect(players.zone(s.index, "nauvis", b.x2 + 2, b.y2 + 2, nil) == "gridworld:se", "the se square")
		ctx.expect(players.zone(s.index, "nauvis", b.x1 - 1, b.y1 + 3, nil) == "gridworld:nw", "west strip near nw")
		ctx.expect(players.zone(s.index, "nauvis", b.x2 + 1, b.y2 - 9, nil) ~= "gridworld:se", "9 tiles back: not the corner")
		ctx.expect(players.zone(s.index, "nauvis", b.x2 + 1, b.y2 - 8.3, "gridworld:se") == "gridworld:se", "held to 8.5")
	end)
end)

t.case("zones: a corner key's arrival lands inside this tile, at the nearest point to where they left", function(ctx)
	local who
	ctx.at(320, function()
		local b = storage.gridworld.tiles.nauvis
		local s = game.surfaces.nauvis
		who = s.create_entity({ name = "character", position = { (b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2 }, force = "player" })
		ue_rt.player_join("zed", who.unit_number)
		ue_rt.inbox("universal_edges", helpers.table_to_json({ { id = "00006e07.1", type = "ue.player.arrival",
			payload = { player = "zed", entry = { key = "gridworld:nw", surface = "nauvis", x = b.x1 - 3, y = b.y1 - 2,
			trace = "t-zed" } } } }))
	end)
	ctx.at(322, function()
		local b = storage.gridworld.tiles.nauvis
		ctx.expect(who.position.x >= b.x1 + 0.5 and who.position.x <= b.x1 + 8.5 and who.position.y >= b.y1 + 0.5
			and who.position.y <= b.y1 + 8.5, "inside, near the north-west corner")
		who.destroy()
	end)
end)
