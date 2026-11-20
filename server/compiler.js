/**
 * Compiler: Blueprint -> Roblox-Studio-Aktionen + vollständige Luau-Skripte.
 *
 * Aktionstypen (werden vom Studio-Plugin ausgeführt):
 *  - deleteInstance  { path, optional }
 *  - createTree      { parentPath, tree, ifExists: 'skip' | 'replace' }
 *  - createScript    { path, scriptType, source, ifExists: 'replace' | 'skip' }
 *  - setProperties   { path, properties }
 *  - selectInstance  { path }
 *
 * Werte in `properties` sind typisiert:
 *  { __type:'Vector3', value:[x,y,z] } | { __type:'Color3', value:'#rrggbb' }
 *  { __type:'CFrame', position:[..], rotation:[deg,deg,deg] }
 *  { __type:'Enum', enum:'Material', item:'Grass' } | primitive
 */

import { RARITIES } from './blueprint.js';
import { toLuau, scriptHeader } from './luau.js';

export const ROOT = 'RobloxStudioAI';
const WORKSPACE_ROOT = `Workspace.${ROOT}`;
const RE_ROOT = `ReplicatedStorage.${ROOT}`;
const SSS_ROOT = `ServerScriptService.${ROOT}`;
const CLIENT_ROOT = 'StarterPlayer.StarterPlayerScripts.RobloxStudioAI';

/* ------------------------- Property-Kodierung -------------------------- */

export const vec3 = (x, y, z) => ({ __type: 'Vector3', value: [x, y, z] });
export const color3 = (hex) => ({ __type: 'Color3', value: hex });
export const cf = (position, rotation = [0, 0, 0]) => ({ __type: 'CFrame', position, rotation });
export const enumProp = (enumName, item) => ({ __type: 'Enum', enum: enumName, item });

/* ---------------------------- Weltaufbau ------------------------------- */

function billboard(name, text, offsetY, textColor = '#ffffff', width = 200) {
  return {
    className: 'BillboardGui',
    name,
    properties: {
      Size: { __type: 'UDim2', value: [width, 40] },
      StudsOffset: vec3(0, offsetY, 0),
      AlwaysOnTop: true,
      MaxDistance: 120,
    },
    children: [
      {
        className: 'TextLabel',
        name: 'Label',
        properties: {
          Size: { __type: 'UDim2', value: [1, 0, 1, 0], scale: true },
          BackgroundTransparency: 1,
          Text: text,
          TextColor3: color3(textColor),
          TextScaled: true,
          Font: enumProp('Font', 'GothamBold'),
          TextStrokeTransparency: 0.5,
        },
      },
    ],
  };
}

function buildingTree(building, island, theme) {
  const [w, h, d] = building.size;
  const x = island.position[0] + building.offset[0];
  const z = island.position[2] + building.offset[1];
  return {
    className: 'Model',
    name: building.name.replace(/[^A-Za-z0-9_]/g, '') || 'Gebaeude',
    children: [
      {
        className: 'Part',
        name: 'Base',
        properties: {
          Size: vec3(w, h, d),
          CFrame: cf([x, h / 2, z]),
          Color: color3(building.color),
          Material: enumProp('Material', 'Concrete'),
          Anchored: true,
        },
        children: [billboard('Sign', building.name, h / 2 + 4, '#ffffff')],
      },
      {
        className: 'Part',
        name: 'Roof',
        properties: {
          Size: vec3(w + 4, 2, d + 4),
          CFrame: cf([x, h + 1, z]),
          Color: color3(theme.palette[1] || '#ffffff'),
          Material: enumProp('Material', 'Slate'),
          Anchored: true,
        },
      },
      {
        className: 'Part',
        name: 'Door',
        properties: {
          Size: vec3(4, 7, 1),
          CFrame: cf([x, 3.5, z + d / 2 + 0.6]),
          Color: color3('#3a2a1c'),
          Material: enumProp('Material', 'Wood'),
          Anchored: true,
          CanCollide: false,
        },
      },
    ],
  };
}

function decorationTree(island, index, theme) {
  const angle = (index * 2.4) % (Math.PI * 2);
  const distance = island.radius * 0.75;
  const x = island.position[0] + Math.cos(angle) * distance;
  const z = island.position[2] + Math.sin(angle) * distance;
  return {
    className: 'Model',
    name: `Deko_${index + 1}`,
    children: [
      {
        className: 'Part',
        name: 'Trunk',
        properties: {
          Size: vec3(2, 10, 2),
          CFrame: cf([x, 5, z]),
          Color: color3('#6b4b2a'),
          Material: enumProp('Material', 'Wood'),
          Anchored: true,
        },
      },
      {
        className: 'Part',
        name: 'Crown',
        properties: {
          Size: vec3(9, 9, 9),
          CFrame: cf([x, 13, z]),
          Color: color3(theme.palette[index % theme.palette.length] || '#5fa85f'),
          Material: enumProp('Material', 'Grass'),
          Anchored: true,
          CanCollide: false,
        },
      },
    ],
  };
}

function islandTree(island, theme, index) {
  const [ix, , iz] = island.position;
  return {
    className: 'Model',
    name: island.name.replace(/[^A-Za-z0-9_]/g, '') || `Insel_${index + 1}`,
    children: [
      {
        className: 'Part',
        name: 'Base',
        properties: {
          Shape: enumProp('PartType', 'Cylinder'),
          Size: vec3(island.radius * 2, island.height, island.radius * 2),
          CFrame: cf([ix, -island.height / 2, iz], [0, 0, 90]),
          Color: color3(island.color),
          Material: enumProp('Material', 'Grass'),
          Anchored: true,
        },
      },
      {
        className: 'Folder',
        name: 'Buildings',
        children: island.buildings.map((building) => buildingTree(building, island, theme)),
      },
      {
        className: 'Folder',
        name: 'Deko',
        children: [0, 1, 2].map((i) => decorationTree(island, i + index, theme)),
      },
      billboard('InselSchild', island.name, island.height + 6, '#ffffff', 260),
    ],
  };
}

function enemyTree(enemy) {
  const size = enemy.isBoss ? 8 : 4;
  const height = enemy.isBoss ? 10 : 5;
  const [x, y, z] = enemy.position;
  return {
    className: 'Model',
    name: `Enemy_${enemy.name.replace(/[^A-Za-z0-9_]/g, '')}`,
    attributes: {
      EnemyName: enemy.name,
      HP: enemy.hp,
      MaxHP: enemy.hp,
      Damage: enemy.damage,
      Level: enemy.level,
      IsBoss: enemy.isBoss,
      RewardCoins: enemy.rewardCoins,
      RewardXp: enemy.rewardXp,
      Respawn: enemy.respawn,
    },
    children: [
      {
        className: 'Part',
        name: 'Body',
        properties: {
          Size: vec3(size, height, size),
          CFrame: cf([x, y + height / 2, z]),
          Color: color3(enemy.color),
          Material: enumProp('Material', enemy.isBoss ? 'Neon' : 'Slate'),
          Anchored: true,
        },
        children: [
          billboard('NameTag', `${enemy.name} (Lv ${enemy.level})${enemy.isBoss ? ' - BOSS' : ''}`, height / 2 + 4, enemy.isBoss ? '#ffb43a' : '#ffffff', 260),
          {
            className: 'BillboardGui',
            name: 'HealthBar',
            properties: {
              Size: { __type: 'UDim2', value: [160, 14] },
              StudsOffset: vec3(0, height / 2 + 1.5, 0),
              AlwaysOnTop: true,
            },
            children: [
              {
                className: 'Frame',
                name: 'Back',
                properties: {
                  Size: { __type: 'UDim2', value: [1, 0, 1, 0], scale: true },
                  BackgroundColor3: color3('#1b1f2a'),
                  BorderSizePixel: 0,
                },
                children: [
                  {
                    className: 'Frame',
                    name: 'Fill',
                    properties: {
                      Size: { __type: 'UDim2', value: [1, 0, 1, 0], scale: true },
                      BackgroundColor3: color3('#e5484d'),
                      BorderSizePixel: 0,
                    },
                  },
                ],
              },
            ],
          },
          {
            className: 'ProximityPrompt',
            name: 'AttackEnemy',
            properties: {
              ActionText: 'Angreifen',
              ObjectText: enemy.name,
              HoldDuration: 0.15,
              MaxActivationDistance: 18,
              RequiresLineOfSight: false,
            },
          },
        ],
      },
    ],
  };
}

function npcTree(npc) {
  const [x, y, z] = npc.position;
  return {
    className: 'Model',
    name: `NPC_${npc.name.replace(/[^A-Za-z0-9_]/g, '')}`,
    attributes: { NPCName: npc.name, Role: npc.role, Dialogue: npc.dialogue },
    children: [
      {
        className: 'Part',
        name: 'Body',
        properties: {
          Size: vec3(4, 6, 2),
          CFrame: cf([x, y + 3, z]),
          Color: color3(npc.color),
          Material: enumProp('Material', 'SmoothPlastic'),
          Anchored: true,
        },
      },
      {
        className: 'Part',
        name: 'Head',
        properties: {
          Shape: enumProp('PartType', 'Ball'),
          Size: vec3(3, 3, 3),
          CFrame: cf([x, y + 7.5, z]),
          Color: color3('#f0d5b1'),
          Material: enumProp('Material', 'SmoothPlastic'),
          Anchored: true,
        },
        children: [
          billboard('NameTag', `${npc.name} (${npc.role})`, 3, '#7ae7ff', 240),
          {
            className: 'ProximityPrompt',
            name: 'TalkToNPC',
            properties: {
              ActionText: 'Reden',
              ObjectText: npc.name,
              HoldDuration: 0,
              MaxActivationDistance: 12,
              RequiresLineOfSight: false,
            },
          },
        ],
      },
    ],
  };
}

/* ------------------------------ Skripte -------------------------------- */

function configModule(bp) {
  const config = {
    title: bp.title,
    genre: bp.genre,
    currencyName: bp.ui.currencyName,
    accent: bp.ui.accent,
    hatchCost: 100,
    levels: bp.levels,
    rarities: RARITIES.map((r) => ({
      id: r.id,
      label: r.label,
      weight: r.weight,
      multiplier: r.multiplier,
      color: r.color,
    })),
    pets: bp.pets,
    shopItems: bp.shopItems,
    quests: bp.quests,
    enemies: bp.enemies.map((e) => ({
      name: e.name,
      level: e.level,
      hp: e.hp,
      damage: e.damage,
      isBoss: e.isBoss,
      rewardCoins: e.rewardCoins,
      rewardXp: e.rewardXp,
      respawn: e.respawn,
    })),
    npcs: bp.npcs.map((n) => ({ name: n.name, role: n.role, dialogue: n.dialogue })),
    ui: bp.ui,
  };
  return `${scriptHeader('GameConfig - Spieldaten', 'Werte hier anpassen und im Studio testen')}local Config = ${toLuau(config)}\n\nreturn Config\n`;
}

function playerStateModule() {
  return `${scriptHeader('PlayerState - Spielerdaten, Level, Quests')}local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local DataStoreService = game:GetService("DataStoreService")
local RunService = game:GetService("RunService")

local root = ReplicatedStorage:WaitForChild("RobloxStudioAI")
local Config = require(root:WaitForChild("GameConfig"))
local Remotes = root:WaitForChild("Remotes")

local PlayerState = {}
local states = {}
local dataStore = nil

if not RunService:IsStudio() then
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore("RobloxStudioAI_v1")
	end)
	if ok then
		dataStore = result
	end
end

local function newQuests()
	local quests = {}
	for _, quest in ipairs(Config.quests) do
		quests[quest.id] = { progress = 0, claimed = false }
	end
	return quests
end

local function defaultState()
	return {
		coins = 0,
		xp = 0,
		level = 1,
		pets = {},
		equipped = nil,
		inventory = {},
		quests = newQuests(),
		hatched = 0,
		purchases = 0,
	}
end

function PlayerState.xpForLevel(level)
	if level >= Config.levels.maxLevel then
		return math.huge
	end
	return math.floor(Config.levels.baseXp * (Config.levels.growth ^ (level - 1)))
end

function PlayerState.get(player)
	return states[player]
end

local function snapshot(state)
	local maxXp = PlayerState.xpForLevel(state.level)
	if maxXp == math.huge then
		maxXp = state.xp
	end
	return {
		coins = state.coins,
		xp = state.xp,
		maxXp = maxXp,
		level = state.level,
		pets = state.pets,
		equipped = state.equipped,
		inventory = state.inventory,
		quests = state.quests,
	}
end

function PlayerState.notify(player, text, kind)
	local remote = Remotes:FindFirstChild("Notify")
	if remote then
		remote:FireClient(player, text, kind or "info")
	end
end

function PlayerState.push(player)
	local state = states[player]
	if not state then
		return
	end
	local leaderstats = player:FindFirstChild("leaderstats")
	if leaderstats then
		local coins = leaderstats:FindFirstChild("Coins")
		local level = leaderstats:FindFirstChild("Level")
		if coins then
			coins.Value = state.coins
		end
		if level then
			level.Value = state.level
		end
	end
	local remote = Remotes:FindFirstChild("StateChanged")
	if remote then
		remote:FireClient(player, snapshot(state))
	end
end

function PlayerState.addCoins(player, amount)
	local state = states[player]
	if not state then
		return false
	end
	state.coins = math.max(0, state.coins + amount)
	PlayerState.push(player)
	return true
end

function PlayerState.addXp(player, amount)
	local state = states[player]
	if not state then
		return
	end
	state.xp += amount
	local leveled = false
	while state.level < Config.levels.maxLevel do
		local needed = PlayerState.xpForLevel(state.level)
		if state.xp < needed then
			break
		end
		state.xp -= needed
		state.level += 1
		leveled = true
		state.coins += 50 * state.level
	end
	PlayerState.push(player)
	if leveled then
		PlayerState.notify(player, "Level " .. tostring(state.level) .. " erreicht!", "success")
	end
end

function PlayerState.addQuestProgress(player, kind, targetName, amount)
	local state = states[player]
	if not state then
		return
	end
	local changed = false
	for _, quest in ipairs(Config.quests) do
		local entry = state.quests[quest.id]
		if entry and not entry.claimed and quest.kind == kind then
			local matches = quest.targetName == nil or quest.targetName == "" or quest.targetName == targetName
			if matches then
				local before = entry.progress
				entry.progress = math.min(quest.required, entry.progress + (amount or 1))
				if entry.progress ~= before then
					changed = true
				end
			end
		end
	end
	if changed then
		PlayerState.push(player)
	end
end

function PlayerState.load(player)
	local state = defaultState()
	if dataStore then
		local ok, data = pcall(function()
			return dataStore:GetAsync("player_" .. tostring(player.UserId))
		end)
		if ok and type(data) == "table" then
			for key, value in pairs(data) do
				if state[key] ~= nil then
					state[key] = value
				end
			end
			if type(state.quests) ~= "table" then
				state.quests = newQuests()
			end
			for _, quest in ipairs(Config.quests) do
				if not state.quests[quest.id] then
					state.quests[quest.id] = { progress = 0, claimed = false }
				end
			end
		end
	end
	states[player] = state
	PlayerState.push(player)
	return state
end

function PlayerState.save(player)
	local state = states[player]
	if not state or not dataStore then
		return
	end
	pcall(function()
		dataStore:SetAsync("player_" .. tostring(player.UserId), state)
	end)
end

function PlayerState.clear(player)
	states[player] = nil
end

return PlayerState
`;
}

function gameService() {
  return `${scriptHeader('GameService - Spielstart, leaderstats, State-Anfragen')}local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local root = ReplicatedStorage:WaitForChild("RobloxStudioAI")
local Remotes = root:WaitForChild("Remotes")
local Config = require(root:WaitForChild("GameConfig"))
local PlayerState = require(script.Parent:WaitForChild("PlayerState"))

local function setupLeaderstats(player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"

	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = 0
	coins.Parent = leaderstats

	local level = Instance.new("IntValue")
	level.Name = "Level"
	level.Value = 1
	level.Parent = leaderstats

	leaderstats.Parent = player
end

Players.PlayerAdded:Connect(function(player)
	setupLeaderstats(player)
	PlayerState.load(player)
	PlayerState.notify(player, Config.title .. " - willkommen!", "success")
end)

Players.PlayerRemoving:Connect(function(player)
	PlayerState.save(player)
	PlayerState.clear(player)
end)

Remotes:WaitForChild("RequestState").OnServerEvent:Connect(function(player)
	PlayerState.push(player)
end)

print("[Roblox Studio AI] " .. Config.title .. " gestartet.")
`;
}

function shopService() {
  return `${scriptHeader('ShopService - Käufe mit Server-Validierung')}local ReplicatedStorage = game:GetService("ReplicatedStorage")

local root = ReplicatedStorage:WaitForChild("RobloxStudioAI")
local Remotes = root:WaitForChild("Remotes")
local Config = require(root:WaitForChild("GameConfig"))
local PlayerState = require(script.Parent:WaitForChild("PlayerState"))

local function findItem(itemId)
	for _, item in ipairs(Config.shopItems) do
		if item.id == itemId then
			return item
		end
	end
	return nil
end

Remotes:WaitForChild("BuyItem").OnServerEvent:Connect(function(player, itemId)
	local state = PlayerState.get(player)
	local item = findItem(itemId)
	if not state or not item then
		return
	end
	if state.coins < item.price then
		PlayerState.notify(player, "Nicht genug " .. Config.currencyName .. ".", "error")
		return
	end
	state.coins -= item.price
	table.insert(state.inventory, { id = item.id, name = item.name, kind = item.kind })
	state.purchases += 1
	if item.kind == "boost" then
		PlayerState.addXp(player, 150)
	end
	PlayerState.addQuestProgress(player, "buy", item.name, 1)
	PlayerState.notify(player, item.name .. " gekauft.", "success")
	PlayerState.push(player)
end)
`;
}

function petService() {
  return `${scriptHeader('PetService - Eier ausbrüten, Pets ausrüsten, Begleiter')}local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local root = ReplicatedStorage:WaitForChild("RobloxStudioAI")
local Remotes = root:WaitForChild("Remotes")
local Config = require(root:WaitForChild("GameConfig"))
local PlayerState = require(script.Parent:WaitForChild("PlayerState"))

local PET_FOLDER_NAME = "RobloxStudioAI_Pets"
local active = {}

local function petFolder()
	local folder = workspace:FindFirstChild(PET_FOLDER_NAME)
	if not folder then
		folder = Instance.new("Folder")
		folder.Name = PET_FOLDER_NAME
		folder.Parent = workspace
	end
	return folder
end

local function rarityById(rarityId)
	for _, rarity in ipairs(Config.rarities) do
		if rarity.id == rarityId then
			return rarity
		end
	end
	return Config.rarities[1]
end

local function rollRarity()
	local total = 0
	for _, rarity in ipairs(Config.rarities) do
		total += rarity.weight
	end
	local roll = math.random() * total
	local acc = 0
	for _, rarity in ipairs(Config.rarities) do
		acc += rarity.weight
		if roll <= acc then
			return rarity.id
		end
	end
	return Config.rarities[1].id
end

local function pickPet(rarityId)
	local pool = {}
	for _, pet in ipairs(Config.pets) do
		if pet.rarity == rarityId then
			table.insert(pool, pet)
		end
	end
	if #pool == 0 then
		pool = Config.pets
	end
	return pool[math.random(1, #pool)]
end

local function despawn(player)
	local model = active[player]
	if model then
		model:Destroy()
	end
	active[player] = nil
end

local function spawnPet(player, pet)
	despawn(player)
	local model = Instance.new("Model")
	model.Name = "Pet_" .. pet.name

	local body = Instance.new("Part")
	body.Name = "Body"
	body.Shape = Enum.PartType.Ball
	body.Size = Vector3.new(2, 2, 2)
	body.Color = Color3.fromHex(rarityById(pet.rarity).color)
	body.Material = Enum.Material.Neon
	body.CanCollide = false
	body.Anchored = false
	body.Parent = model

	local label = Instance.new("BillboardGui")
	label.Name = "Label"
	label.Size = UDim2.fromOffset(180, 40)
	label.StudsOffset = Vector3.new(0, 2, 0)
	label.AlwaysOnTop = true
	label.Parent = body

	local text = Instance.new("TextLabel")
	text.Size = UDim2.fromScale(1, 1)
	text.BackgroundTransparency = 1
	text.TextColor3 = Color3.new(1, 1, 1)
	text.TextStrokeTransparency = 0.4
	text.TextScaled = true
	text.Font = Enum.Font.GothamBold
	text.Text = pet.name .. " x" .. tostring(pet.multiplier)
	text.Parent = label

	model.PrimaryPart = body
	model.Parent = petFolder()
	active[player] = model
end

RunService.Heartbeat:Connect(function(delta)
	for player, model in pairs(active) do
		local character = player.Character
		local rootPart = character and character:FindFirstChild("HumanoidRootPart")
		local body = model.PrimaryPart
		if body and rootPart then
			local target = rootPart.CFrame * CFrame.new(3, 1.5, 3)
			body.CFrame = body.CFrame:Lerp(target, math.clamp(delta * 8, 0, 1))
		end
	end
end)

Players.PlayerRemoving:Connect(function(player)
	despawn(player)
end)

Remotes:WaitForChild("HatchPet").OnServerEvent:Connect(function(player)
	local state = PlayerState.get(player)
	if not state then
		return
	end
	if state.coins < Config.hatchCost then
		PlayerState.notify(player, "Ein Ei kostet " .. tostring(Config.hatchCost) .. " " .. Config.currencyName .. ".", "error")
		return
	end
	state.coins -= Config.hatchCost
	local pet = pickPet(rollRarity())
	local uid = pet.id .. "_" .. tostring(os.time()) .. "_" .. tostring(math.random(1000, 9999))
	table.insert(state.pets, {
		uid = uid,
		id = pet.id,
		name = pet.name,
		rarity = pet.rarity,
		multiplier = pet.multiplier,
	})
	state.hatched += 1
	if not state.equipped then
		state.equipped = uid
		spawnPet(player, pet)
	end
	PlayerState.addQuestProgress(player, "hatch", nil, 1)
	PlayerState.notify(player, pet.name .. " ausgebrütet!", "success")
	PlayerState.push(player)
end)

Remotes:WaitForChild("EquipPet").OnServerEvent:Connect(function(player, uid)
	local state = PlayerState.get(player)
	if not state then
		return
	end
	for _, pet in ipairs(state.pets) do
		if pet.uid == uid then
			state.equipped = uid
			spawnPet(player, pet)
			PlayerState.notify(player, pet.name .. " ausgerüstet.", "success")
			PlayerState.push(player)
			return
		end
	end
end)
`;
}

function questService() {
  return `${scriptHeader('QuestService - Quests abgeben und Belohnungen vergeben')}local ReplicatedStorage = game:GetService("ReplicatedStorage")

local root = ReplicatedStorage:WaitForChild("RobloxStudioAI")
local Remotes = root:WaitForChild("Remotes")
local Config = require(root:WaitForChild("GameConfig"))
local PlayerState = require(script.Parent:WaitForChild("PlayerState"))

Remotes:WaitForChild("ClaimQuest").OnServerEvent:Connect(function(player, questId)
	local state = PlayerState.get(player)
	if not state then
		return
	end
	for _, quest in ipairs(Config.quests) do
		if quest.id == questId then
			local entry = state.quests[quest.id]
			if not entry or entry.claimed then
				return
			end
			if entry.progress < quest.required then
				PlayerState.notify(player, "Quest noch nicht abgeschlossen.", "error")
				return
			end
			entry.claimed = true
			PlayerState.addCoins(player, quest.rewardCoins)
			PlayerState.addXp(player, quest.rewardXp)
			PlayerState.notify(player, "Quest abgeschlossen: +" .. tostring(quest.rewardCoins) .. " " .. Config.currencyName, "success")
			PlayerState.push(player)
			return
		end
	end
end)
`;
}

function combatService() {
  return `${scriptHeader('CombatService - Gegner, Bosse, Schaden, Respawn')}local Players = game:GetService("Players")
local ProximityPromptService = game:GetService("ProximityPromptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local root = ReplicatedStorage:WaitForChild("RobloxStudioAI")
local Config = require(root:WaitForChild("GameConfig"))
local PlayerState = require(script.Parent:WaitForChild("PlayerState"))

local worldRoot = workspace:WaitForChild("RobloxStudioAI")
local enemyFolder = worldRoot:WaitForChild("Enemies")

local function updateBar(model)
	local body = model:FindFirstChild("Body")
	local bar = body and body:FindFirstChild("HealthBar")
	local fill = bar and bar:FindFirstChild("Back") and bar.Back:FindFirstChild("Fill")
	if not fill then
		return
	end
	local hp = model:GetAttribute("HP") or 0
	local maxHp = model:GetAttribute("MaxHP") or 1
	fill.Size = UDim2.new(math.clamp(hp / maxHp, 0, 1), 0, 1, 0)
end

local function petMultiplier(player)
	local state = PlayerState.get(player)
	if not state or not state.equipped then
		return 1
	end
	for _, pet in ipairs(state.pets) do
		if pet.uid == state.equipped then
			return pet.multiplier
		end
	end
	return 1
end

ProximityPromptService.PromptTriggered:Connect(function(prompt, player)
	if prompt.Name ~= "AttackEnemy" then
		return
	end
	local model = prompt.Parent and prompt.Parent.Parent
	if not model or not model:GetAttribute("MaxHP") then
		return
	end
	local body = model:FindFirstChild("Body")
	local character = player.Character
	local rootPart = character and character:FindFirstChild("HumanoidRootPart")
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not body or not rootPart or not humanoid or humanoid.Health <= 0 then
		return
	end
	if (rootPart.Position - body.Position).Magnitude > 22 then
		return
	end
	local state = PlayerState.get(player)
	if not state then
		return
	end
	local levelBonus = 1 + (state.level - 1) * 0.12
	local damage = math.floor(10 * levelBonus * petMultiplier(player))
	local hp = math.max(0, (model:GetAttribute("HP") or 0) - damage)
	model:SetAttribute("HP", hp)
	updateBar(model)

	if hp > 0 then
		return
	end

	local enemyName = model:GetAttribute("EnemyName") or model.Name
	local rewardCoins = model:GetAttribute("RewardCoins") or 0
	local rewardXp = model:GetAttribute("RewardXp") or 0
	local respawn = model:GetAttribute("Respawn") or 12
	local maxHp = model:GetAttribute("MaxHP") or 1

	PlayerState.addCoins(player, rewardCoins)
	PlayerState.addXp(player, rewardXp)
	PlayerState.addQuestProgress(player, "defeat", enemyName, 1)
	PlayerState.notify(player, enemyName .. " besiegt! +" .. tostring(rewardCoins) .. " " .. Config.currencyName, "success")

	body.Transparency = 1
	prompt.Enabled = false
	task.delay(respawn, function()
		if model.Parent then
			model:SetAttribute("HP", maxHp)
			body.Transparency = 0
			prompt.Enabled = true
			updateBar(model)
		end
	end)
end)

task.spawn(function()
	while true do
		task.wait(2)
		for _, model in ipairs(enemyFolder:GetChildren()) do
			local body = model:FindFirstChild("Body")
			local damage = model:GetAttribute("Damage") or 5
			if body and body.Transparency < 1 then
				for _, player in ipairs(Players:GetPlayers()) do
					local character = player.Character
					local humanoid = character and character:FindFirstChildOfClass("Humanoid")
					local rootPart = character and character:FindFirstChild("HumanoidRootPart")
					if humanoid and humanoid.Health > 0 and rootPart and (rootPart.Position - body.Position).Magnitude < 12 then
						humanoid:TakeDamage(damage)
					end
				end
			end
		end
	end
end)
`;
}

function npcService() {
  return `${scriptHeader('NPCService - Dialoge über ProximityPrompts')}local ProximityPromptService = game:GetService("ProximityPromptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local root = ReplicatedStorage:WaitForChild("RobloxStudioAI")
local PlayerState = require(script.Parent:WaitForChild("PlayerState"))

ProximityPromptService.PromptTriggered:Connect(function(prompt, player)
	if prompt.Name ~= "TalkToNPC" then
		return
	end
	local dialogue = prompt:GetAttribute("Dialogue")
	if not dialogue and prompt.Parent then
		local model = prompt.Parent.Parent
		dialogue = model and model:GetAttribute("Dialogue")
	end
	if dialogue then
		PlayerState.notify(player, dialogue, "info")
	end
end)
`;
}

function clientUiScript() {
  return `${scriptHeader('ClientUI - HUD, Shop, Pets, Quests')}local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")
local root = ReplicatedStorage:WaitForChild("RobloxStudioAI")
local Config = require(root:WaitForChild("GameConfig"))
local Remotes = root:WaitForChild("Remotes")

local ACCENT = Color3.fromHex(Config.ui.accent)
local PANEL_BG = Color3.fromRGB(16, 18, 26)
local PANEL_SOFT = Color3.fromRGB(28, 32, 44)
local TEXT = Color3.fromRGB(238, 242, 255)

local function create(className, props, parent)
	local instance = Instance.new(className)
	for key, value in pairs(props or {}) do
		if key ~= "Parent" then
			instance[key] = value
		end
	end
	if parent then
		instance.Parent = parent
	end
	return instance
end

local gui = create("ScreenGui", {
	Name = "RobloxStudioAI_HUD",
	ResetOnSpawn = false,
	IgnoreGuiInset = true,
	ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
}, playerGui)

local hud = create("Frame", {
	Name = "HUD",
	Position = UDim2.fromOffset(18, 18),
	Size = UDim2.fromOffset(280, 110),
	BackgroundColor3 = PANEL_BG,
	BackgroundTransparency = 0.1,
	BorderSizePixel = 0,
}, gui)
create("UICorner", { CornerRadius = UDim.new(0, 12) }, hud)

create("TextLabel", {
	Name = "GameTitle",
	Position = UDim2.fromOffset(14, 10),
	Size = UDim2.new(1, -28, 0, 22),
	BackgroundTransparency = 1,
	Text = Config.title,
	TextColor3 = ACCENT,
	TextXAlignment = Enum.TextXAlignment.Left,
	Font = Enum.Font.GothamBold,
	TextSize = 18,
}, hud)

local coinsLabel = create("TextLabel", {
	Name = "Coins",
	Position = UDim2.fromOffset(14, 36),
	Size = UDim2.new(0.5, -14, 0, 20),
	BackgroundTransparency = 1,
	Text = "0 " .. Config.currencyName,
	TextColor3 = Color3.fromRGB(255, 210, 90),
	TextXAlignment = Enum.TextXAlignment.Left,
	Font = Enum.Font.Gotham,
	TextSize = 16,
}, hud)

local levelLabel = create("TextLabel", {
	Name = "Level",
	Position = UDim2.new(0.5, 0, 0, 36),
	Size = UDim2.new(0.5, -14, 0, 20),
	BackgroundTransparency = 1,
	Text = "Level 1",
	TextColor3 = TEXT,
	TextXAlignment = Enum.TextXAlignment.Right,
	Font = Enum.Font.Gotham,
	TextSize = 16,
}, hud)

local xpBack = create("Frame", {
	Name = "XPBack",
	Position = UDim2.fromOffset(14, 62),
	Size = UDim2.new(1, -28, 0, 12),
	BackgroundColor3 = PANEL_SOFT,
	BorderSizePixel = 0,
}, hud)
create("UICorner", { CornerRadius = UDim.new(0, 6) }, xpBack)

local xpFill = create("Frame", {
	Name = "XPFill",
	Size = UDim2.new(0, 0, 1, 0),
	BackgroundColor3 = ACCENT,
	BorderSizePixel = 0,
}, xpBack)
create("UICorner", { CornerRadius = UDim.new(0, 6) }, xpFill)

local xpLabel = create("TextLabel", {
	Name = "XPText",
	Position = UDim2.fromOffset(14, 80),
	Size = UDim2.new(1, -28, 0, 18),
	BackgroundTransparency = 1,
	Text = "0 / 120 XP",
	TextColor3 = Color3.fromRGB(170, 180, 200),
	TextXAlignment = Enum.TextXAlignment.Left,
	Font = Enum.Font.Gotham,
	TextSize = 13,
}, hud)

local buttonBar = create("Frame", {
	Name = "Buttons",
	Position = UDim2.new(1, -18, 0, 18),
	AnchorPoint = Vector2.new(1, 0),
	Size = UDim2.fromOffset(120, 150),
	BackgroundTransparency = 1,
}, gui)
create("UIListLayout", {
	Padding = UDim.new(0, 8),
	SortOrder = Enum.SortOrder.LayoutOrder,
	HorizontalAlignment = Enum.HorizontalAlignment.Right,
}, buttonBar)

local panel = create("Frame", {
	Name = "Panel",
	Position = UDim2.new(0.5, 0, 0.5, 0),
	AnchorPoint = Vector2.new(0.5, 0.5),
	Size = UDim2.fromOffset(420, 480),
	BackgroundColor3 = PANEL_BG,
	BorderSizePixel = 0,
	Visible = false,
}, gui)
create("UICorner", { CornerRadius = UDim.new(0, 14) }, panel)

local panelTitle = create("TextLabel", {
	Name = "PanelTitle",
	Position = UDim2.fromOffset(18, 14),
	Size = UDim2.new(1, -90, 0, 26),
	BackgroundTransparency = 1,
	Text = "Shop",
	TextColor3 = ACCENT,
	TextXAlignment = Enum.TextXAlignment.Left,
	Font = Enum.Font.GothamBold,
	TextSize = 20,
}, panel)

local closeButton = create("TextButton", {
	Name = "Close",
	Position = UDim2.new(1, -46, 0, 14),
	Size = UDim2.fromOffset(32, 26),
	BackgroundColor3 = PANEL_SOFT,
	Text = "X",
	TextColor3 = TEXT,
	Font = Enum.Font.GothamBold,
	TextSize = 14,
	AutoButtonColor = true,
}, panel)
create("UICorner", { CornerRadius = UDim.new(0, 8) }, closeButton)

local list = create("ScrollingFrame", {
	Name = "List",
	Position = UDim2.fromOffset(14, 52),
	Size = UDim2.new(1, -28, 1, -66),
	BackgroundTransparency = 1,
	BorderSizePixel = 0,
	ScrollBarThickness = 6,
	CanvasSize = UDim2.new(0, 0, 0, 0),
}, panel)
create("UIListLayout", { Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }, list)

local toastHolder = create("Frame", {
	Name = "Toasts",
	Position = UDim2.new(0.5, 0, 0, 20),
	AnchorPoint = Vector2.new(0.5, 0),
	Size = UDim2.fromOffset(420, 200),
	BackgroundTransparency = 1,
}, gui)
create("UIListLayout", { Padding = UDim.new(0, 6), HorizontalAlignment = Enum.HorizontalAlignment.Center }, toastHolder)

local state = nil

local function toast(text, kind)
	local colors = {
		info = Color3.fromRGB(70, 120, 220),
		success = Color3.fromRGB(60, 180, 110),
		error = Color3.fromRGB(220, 80, 80),
	}
	local frame = create("Frame", {
		Size = UDim2.new(1, 0, 0, 38),
		BackgroundColor3 = colors[kind] or colors.info,
		BackgroundTransparency = 0.1,
		BorderSizePixel = 0,
	}, toastHolder)
	create("UICorner", { CornerRadius = UDim.new(0, 10) }, frame)
	create("TextLabel", {
		Size = UDim2.new(1, -20, 1, 0),
		Position = UDim2.fromOffset(10, 0),
		BackgroundTransparency = 1,
		Text = tostring(text),
		TextColor3 = Color3.new(1, 1, 1),
		TextXAlignment = Enum.TextXAlignment.Left,
		Font = Enum.Font.Gotham,
		TextSize = 15,
		TextWrapped = true,
	}, frame)
	task.delay(4, function()
		if frame.Parent then
			TweenService:Create(frame, TweenInfo.new(0.3), { BackgroundTransparency = 1 }):Play()
			task.wait(0.3)
			frame:Destroy()
		end
	end)
end

local function makeRow(titleText, subtitleText, buttonText, onActivate, enabled)
	local row = create("Frame", {
		Size = UDim2.new(1, 0, 0, 64),
		BackgroundColor3 = PANEL_SOFT,
		BorderSizePixel = 0,
	}, list)
	create("UICorner", { CornerRadius = UDim.new(0, 10) }, row)
	create("TextLabel", {
		Position = UDim2.fromOffset(12, 8),
		Size = UDim2.new(1, -110, 0, 22),
		BackgroundTransparency = 1,
		Text = titleText,
		TextColor3 = TEXT,
		TextXAlignment = Enum.TextXAlignment.Left,
		Font = Enum.Font.GothamBold,
		TextSize = 15,
	}, row)
	create("TextLabel", {
		Position = UDim2.fromOffset(12, 32),
		Size = UDim2.new(1, -110, 0, 22),
		BackgroundTransparency = 1,
		Text = subtitleText,
		TextColor3 = Color3.fromRGB(170, 180, 200),
		TextXAlignment = Enum.TextXAlignment.Left,
		Font = Enum.Font.Gotham,
		TextSize = 13,
	}, row)
	local button = create("TextButton", {
		Position = UDim2.new(1, -96, 0.5, 0),
		AnchorPoint = Vector2.new(0, 0.5),
		Size = UDim2.fromOffset(84, 32),
		BackgroundColor3 = enabled == false and Color3.fromRGB(60, 64, 78) or ACCENT,
		Text = buttonText,
		TextColor3 = Color3.new(1, 1, 1),
		Font = Enum.Font.GothamBold,
		TextSize = 13,
		AutoButtonColor = true,
	}, row)
	create("UICorner", { CornerRadius = UDim.new(0, 8) }, button)
	button.Activated = nil
	button.MouseButton1Click:Connect(function()
		if enabled == false then
			return
		end
		onActivate()
	end)
	return row
end

local function clearList()
	for _, child in ipairs(list:GetChildren()) do
		if child:IsA("Frame") then
			child:Destroy()
		end
	end
	list.CanvasSize = UDim2.new(0, 0, 0, 0)
end

local builders = {}

builders.shop = function()
	panelTitle.Text = "Shop"
	for _, item in ipairs(Config.shopItems) do
		makeRow(item.name, item.price .. " " .. Config.currencyName .. " - " .. item.description, "Kaufen", function()
			Remotes.BuyItem:FireServer(item.id)
		end, state and state.coins >= item.price)
	end
end

builders.pets = function()
	panelTitle.Text = "Pets (" .. (state and #state.pets or 0) .. ")"
	makeRow("Ei ausbrüten", "Zufälliges Pet für " .. Config.hatchCost .. " " .. Config.currencyName, "Brüten", function()
		Remotes.HatchPet:FireServer()
	end, state and state.coins >= Config.hatchCost)
	for _, pet in ipairs(state and state.pets or {}) do
		local equipped = state.equipped == pet.uid
		makeRow(pet.name .. " [" .. pet.rarity .. "]", "Multiplikator x" .. tostring(pet.multiplier), equipped and "Aktiv" or "Ausrüsten", function()
			Remotes.EquipPet:FireServer(pet.uid)
		end, not equipped)
	end
end

builders.quests = function()
	panelTitle.Text = "Quests"
	for _, quest in ipairs(Config.quests) do
		local entry = state and state.quests and state.quests[quest.id]
		local progress = entry and entry.progress or 0
		local claimed = entry and entry.claimed
		local subtitle = progress .. " / " .. quest.required .. " - Belohnung: " .. quest.rewardCoins .. " " .. Config.currencyName
		makeRow(quest.title, subtitle, claimed and "Erledigt" or "Abgeben", function()
			Remotes.ClaimQuest:FireServer(quest.id)
		end, not claimed and progress >= quest.required)
	end
end

local function openPanel(kind)
	clearList()
	local builder = builders[kind]
	if not builder then
		return
	end
	builder()
	panel.Visible = true
	list.CanvasSize = UDim2.new(0, 0, 0, math.max(0, #list:GetChildren() * 72))
end

closeButton.MouseButton1Click:Connect(function()
	panel.Visible = false
end)

local buttonDefs = {
	{ label = "Shop", kind = "shop" },
	{ label = "Pets", kind = "pets" },
	{ label = "Quests", kind = "quests" },
}

for index, def in ipairs(buttonDefs) do
	local button = create("TextButton", {
		Name = def.label,
		LayoutOrder = index,
		Size = UDim2.fromOffset(120, 40),
		BackgroundColor3 = PANEL_BG,
		BackgroundTransparency = 0.1,
		Text = def.label,
		TextColor3 = TEXT,
		Font = Enum.Font.GothamBold,
		TextSize = 15,
		AutoButtonColor = true,
	}, buttonBar)
	create("UICorner", { CornerRadius = UDim.new(0, 10) }, button)
	button.MouseButton1Click:Connect(function()
		if panel.Visible then
			panel.Visible = false
		else
			openPanel(def.kind)
		end
	end)
end

Remotes.StateChanged.OnClientEvent:Connect(function(newState)
	state = newState
	coinsLabel.Text = tostring(state.coins) .. " " .. Config.currencyName
	levelLabel.Text = "Level " .. tostring(state.level)
	xpLabel.Text = tostring(state.xp) .. " / " .. tostring(state.maxXp) .. " XP"
	local ratio = 0
	if state.maxXp and state.maxXp > 0 then
		ratio = math.clamp(state.xp / state.maxXp, 0, 1)
	end
	TweenService:Create(xpFill, TweenInfo.new(0.25), { Size = UDim2.new(ratio, 0, 1, 0) }):Play()
	if panel.Visible then
		local current = panelTitle.Text
		clearList()
		if current:sub(1, 4) == "Shop" then
			builders.shop()
		elseif current:sub(1, 4) == "Pets" then
			builders.pets()
		elseif current:sub(1, 6) == "Quests" then
			builders.quests()
		end
	end
end)

Remotes.Notify.OnClientEvent:Connect(function(text, kind)
	toast(text, kind)
end)

Remotes.RequestState:FireServer()
`;
}

export function scriptSources(bp) {
  return [
    { path: `${RE_ROOT}.GameConfig`, scriptType: 'ModuleScript', name: 'GameConfig', source: configModule(bp) },
    { path: `${SSS_ROOT}.PlayerState`, scriptType: 'ModuleScript', name: 'PlayerState', source: playerStateModule() },
    { path: `${SSS_ROOT}.GameService`, scriptType: 'Script', name: 'GameService', source: gameService() },
    { path: `${SSS_ROOT}.ShopService`, scriptType: 'Script', name: 'ShopService', source: shopService() },
    { path: `${SSS_ROOT}.PetService`, scriptType: 'Script', name: 'PetService', source: petService() },
    { path: `${SSS_ROOT}.QuestService`, scriptType: 'Script', name: 'QuestService', source: questService() },
    { path: `${SSS_ROOT}.CombatService`, scriptType: 'Script', name: 'CombatService', source: combatService() },
    { path: `${SSS_ROOT}.NPCService`, scriptType: 'Script', name: 'NPCService', source: npcService() },
    { path: `${CLIENT_ROOT}.ClientUI`, scriptType: 'LocalScript', name: 'ClientUI', source: clientUiScript() },
  ];
}

/* ---------------------------- Kompilierung ----------------------------- */

function existingNames(previous, key) {
  const list = previous?.[key];
  if (!Array.isArray(list)) return new Set();
  return new Set(list.map((entry) => entry.name));
}

/**
 * Erzeugt alle Studio-Aktionen für einen Blueprint.
 * mode 'full'  -> alter Build wird entfernt und komplett neu aufgebaut
 * mode 'patch' -> nur neue Inseln/NPCs/Gegner ergänzen, Skripte + Config aktualisieren
 */
export function compileBlueprint(bp, { mode = 'full', previous = null } = {}) {
  const actions = [];
  const isFull = mode === 'full';
  const ifExists = isFull ? 'replace' : 'skip';

  if (isFull) {
    actions.push({
      type: 'deleteInstance',
      path: WORKSPACE_ROOT,
      optional: true,
      requiresConfirmation: true,
      summary: 'Alten generierten Build entfernen',
    });
  }

  actions.push({
    type: 'createTree',
    parentPath: 'Workspace',
    ifExists,
    requiresConfirmation: true,
    summary: 'Weltordner anlegen (Map, Gegner, NPCs)',
    tree: {
      className: 'Folder',
      name: ROOT,
      children: [
        {
          className: 'Folder',
          name: 'Map',
          children: [
            {
              className: 'Part',
              name: 'Ground',
              properties: {
                Size: vec3(bp.world.size[0], 8, bp.world.size[1]),
                CFrame: cf([0, -4, 0]),
                Color: color3(bp.theme.ground),
                Material: enumProp('Material', 'Grass'),
                Anchored: true,
              },
            },
            {
              className: 'Part',
              name: 'Water',
              properties: {
                Size: vec3(bp.world.size[0], 2, bp.world.size[1]),
                CFrame: cf([0, -9.5, 0]),
                Color: color3(bp.theme.water),
                Material: enumProp('Material', 'SmoothPlastic'),
                Transparency: 0.35,
                Anchored: true,
                CanCollide: false,
              },
            },
            {
              className: 'SpawnLocation',
              name: 'Spawn',
              properties: {
                Size: vec3(14, 1, 14),
                CFrame: cf([bp.world.islands[0].position[0], 1, bp.world.islands[0].position[2]]),
                Color: color3(bp.ui.accent),
                Material: enumProp('Material', 'Neon'),
                Anchored: true,
                Neutral: true,
                Duration: 0,
              },
            },
            { className: 'Folder', name: 'Islands', children: [] },
          ],
        },
        { className: 'Folder', name: 'Enemies' },
        { className: 'Folder', name: 'NPCs' },
      ],
    },
  });

  const previousIslands = existingNames(previous, 'world');
  const prevIslandNames = new Set((previous?.world?.islands || []).map((island) => island.name.replace(/[^A-Za-z0-9_]/g, '')));

  bp.world.islands.forEach((island, index) => {
    const safeName = island.name.replace(/[^A-Za-z0-9_]/g, '') || `Insel_${index + 1}`;
    if (!isFull && prevIslandNames.has(safeName)) return;
    actions.push({
      type: 'createTree',
      parentPath: `${WORKSPACE_ROOT}.Map.Islands`,
      ifExists,
      requiresConfirmation: true,
      summary: `Insel "${island.name}" mit ${island.buildings.length} Gebäuden bauen`,
      tree: islandTree(island, bp.theme, index),
    });
  });
  void previousIslands;

  const prevEnemyNames = new Set((previous?.enemies || []).map((enemy) => `Enemy_${enemy.name.replace(/[^A-Za-z0-9_]/g, '')}`));
  bp.enemies.forEach((enemy) => {
    const safeName = `Enemy_${enemy.name.replace(/[^A-Za-z0-9_]/g, '')}`;
    if (!isFull && prevEnemyNames.has(safeName)) return;
    actions.push({
      type: 'createTree',
      parentPath: `${WORKSPACE_ROOT}.Enemies`,
      ifExists,
      requiresConfirmation: true,
      summary: `${enemy.isBoss ? 'Boss' : 'Gegner'} "${enemy.name}" (Lv ${enemy.level}, ${enemy.hp} HP) platzieren`,
      tree: enemyTree(enemy),
    });
  });

  const prevNpcNames = new Set((previous?.npcs || []).map((npc) => `NPC_${npc.name.replace(/[^A-Za-z0-9_]/g, '')}`));
  bp.npcs.forEach((npc) => {
    const safeName = `NPC_${npc.name.replace(/[^A-Za-z0-9_]/g, '')}`;
    if (!isFull && prevNpcNames.has(safeName)) return;
    actions.push({
      type: 'createTree',
      parentPath: `${WORKSPACE_ROOT}.NPCs`,
      ifExists,
      requiresConfirmation: true,
      summary: `NPC "${npc.name}" (${npc.role}) mit Dialog hinzufügen`,
      tree: npcTree(npc),
    });
  });

  actions.push({
    type: 'createTree',
    parentPath: 'ReplicatedStorage',
    ifExists: 'skip',
    requiresConfirmation: true,
    summary: 'ReplicatedStorage-Struktur + RemoteEvents anlegen',
    tree: {
      className: 'Folder',
      name: ROOT,
      children: [
        {
          className: 'Folder',
          name: 'Remotes',
          children: ['StateChanged', 'Notify', 'RequestState', 'BuyItem', 'HatchPet', 'EquipPet', 'ClaimQuest'].map((name) => ({
            className: 'RemoteEvent',
            name,
          })),
        },
      ],
    },
  });

  actions.push({
    type: 'setProperties',
    path: 'Lighting',
    requiresConfirmation: false,
    summary: 'Beleuchtung an das Spielthema anpassen',
    properties: {
      Ambient: color3(bp.theme.sky),
      OutdoorAmbient: color3(bp.theme.sky),
      ClockTime: bp.theme.id === 'horror' ? 0.5 : 14,
      Brightness: bp.theme.id === 'horror' ? 0.4 : 2,
    },
  });

  for (const script of scriptSources(bp)) {
    actions.push({
      type: 'createScript',
      path: script.path,
      scriptType: script.scriptType,
      source: script.source,
      ifExists: 'replace',
      requiresConfirmation: true,
      summary: `${script.scriptType} "${script.name}" übertragen (${script.source.split('\n').length} Zeilen)`,
    });
  }

  actions.push({
    type: 'selectInstance',
    path: WORKSPACE_ROOT,
    requiresConfirmation: false,
    summary: 'Ergebnis in Studio markieren',
  });

  return actions;
}

/** Übersicht der erzeugten Skripte (für die UI, ohne die vollen Quelltexte). */
export function scriptOverview(bp) {
  return scriptSources(bp).map((script) => ({
    name: script.name,
    path: script.path,
    type: script.scriptType,
    lines: script.source.split('\n').length,
  }));
}

/** Einzelnes Skript für die Vorschau im Browser. */
export function getScript(bp, name) {
  const found = scriptSources(bp).find((script) => script.name === name);
  return found || null;
}
