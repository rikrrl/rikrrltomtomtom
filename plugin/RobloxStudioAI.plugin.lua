--!nocheck
--[[
	Roblox Studio AI - Studio Plugin (Client-Seite der Bridge)

	Installation:
	1. In Roblox Studio: Plugins-Tab -> "Plugins-Ordner öffnen"
	2. Diese Datei als RobloxStudioAI.lua in den Ordner legen
	3. Studio neu starten -> Werkzeugleiste "Roblox Studio AI"
	4. Server-URL und Projekt-Token aus der Web-App eintragen und "Verbinden" drücken

	Das Plugin fragt den Server regelmäßig nach freigegebenen Aktionen.
	Ohne Freigabe in der Web-App wird nichts in deinem Spiel verändert.
]]

local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local Selection = game:GetService("Selection")
local LogService = game:GetService("LogService")
local Players = game:GetService("Players")

local DEFAULT_SERVER = "__SERVER_URL__"

local state = {
	connected = false,
	polling = false,
	token = "",
	serverUrl = DEFAULT_SERVER,
	status = "Nicht verbunden",
	projectName = nil,
	lastPoll = 0,
}

local function log(text)
	state.status = tostring(text)
	if logLabel then
		logLabel.Text = state.status
	end
	print("[Roblox Studio AI] " .. tostring(text))
end

/* ------------------------------------------------------------------ */
/*  HTTP                                                              */
/* ------------------------------------------------------------------ */

local function request(method, path, body)
	local url = string.gsub(state.serverUrl, "/+$", "") .. path
	local options = {
		Url = url,
		Method = method,
		Headers = { ["Content-Type"] = "application/json" },
	}
	if body then
		options.Body = HttpService:JSONEncode(body)
	end
	local ok, response = pcall(function()
		return HttpService:RequestAsync(options)
	end)
	if not ok then
		return nil, tostring(response)
	end
	if not response.Success then
		local message = "HTTP " .. tostring(response.StatusCode)
		local decoded
		pcall(function()
			decoded = HttpService:JSONDecode(response.Body)
		end)
		if decoded and decoded.error then
			message = message .. ": " .. tostring(decoded.error)
		end
		return nil, message
	end
	local decoded
	local decodeOk = pcall(function()
		decoded = HttpService:JSONDecode(response.Body)
	end)
	if not decodeOk then
		return nil, "Antwort konnte nicht gelesen werden"
	end
	return decoded
end

/* ------------------------------------------------------------------ */
/*  Instanz-Helfer                                                    */
/* ------------------------------------------------------------------ */

local function resolve(path)
	if type(path) ~= "string" or path == "" then
		return nil
	end
	local segments = string.split(path, ".")
	local current
	for index, segment in ipairs(segments) do
		if index == 1 then
			local ok, service = pcall(function()
				return game:GetService(segment)
			end)
			if ok then
				current = service
			else
				current = game:FindFirstChild(segment)
			end
		else
			current = current and current:FindFirstChild(segment)
		end
		if not current then
			return nil
		end
	end
	return current
end

local function ensureFolder(parent, name)
	local existing = parent:FindFirstChild(name)
	if existing then
		return existing
	end
	local folder = Instance.new("Folder")
	folder.Name = name
	folder.Parent = parent
	return folder
end

local function applyValue(instance, key, value)
	if type(value) == "table" then
		local kind = value.__type
		if kind == "Vector3" then
			local v = value.value
			instance[key] = Vector3.new(v[1], v[2], v[3])
		elseif kind == "Color3" then
			instance[key] = Color3.fromHex(value.value)
		elseif kind == "CFrame" then
			local p = value.position
			local r = value.rotation or { 0, 0, 0 }
			instance[key] = CFrame.new(p[1], p[2], p[3])
				* CFrame.Angles(math.rad(r[1]), math.rad(r[2]), math.rad(r[3]))
		elseif kind == "Enum" then
			instance[key] = Enum[value.enum][value.item]
		elseif kind == "UDim2" then
			local v = value.value
			if value.scale then
				instance[key] = UDim2.new(v[1], v[2], v[3], v[4])
			else
				instance[key] = UDim2.fromOffset(v[1], v[2])
			end
		end
		return
	end
	instance[key] = value
end

local function createFromNode(parent, node, mode)
	if type(node) ~= "table" or not node.className or not node.name then
		return nil
	end
	local existing = parent:FindFirstChild(node.name)
	if existing then
		if mode == "skip" then
			return existing
		end
		existing:Destroy()
	end
	local ok, instance = pcall(Instance.new, node.className)
	if not ok or not instance then
		return nil
	end
	instance.Name = node.name
	for key, value in pairs(node.properties or {}) do
		pcall(function()
			applyValue(instance, key, value)
		end)
	end
	for key, value in pairs(node.attributes or {}) do
		pcall(function()
			instance:SetAttribute(key, value)
		end)
	end
	instance.Parent = parent
	for _, child in ipairs(node.children or {}) do
		createFromNode(instance, child, mode)
	end
	return instance
end

local function createScriptAt(path, scriptType, source)
	local segments = string.split(path, ".")
	local name = table.remove(segments)
	local parentPath = table.concat(segments, ".")
	local parent = resolve(parentPath)
	if not parent then
		return nil, "Elternobjekt nicht gefunden: " .. parentPath
	end
	local existing = parent:FindFirstChild(name)
	if existing then
		existing:Destroy()
	end
	local ok, scriptInstance = pcall(Instance.new, scriptType)
	if not ok or not scriptInstance then
		return nil, "Skripttyp ungültig: " .. tostring(scriptType)
	end
	scriptInstance.Name = name
	if scriptInstance:IsA("LuaSourceContainer") then
		scriptInstance.Source = source or ""
	end
	scriptInstance.Parent = parent
	return scriptInstance
end

/* ------------------------------------------------------------------ */
/*  Aktionsausführung                                                 */
/* ------------------------------------------------------------------ */

local function executeAction(action)
	local payload = action.payload or {}
	local kind = action.type

	if kind == "deleteInstance" then
		local target = resolve(payload.path)
		if target then
			target:Destroy()
			return true, "Entfernt: " .. payload.path
		end
		if payload.optional then
			return true, "Nicht vorhanden (optional): " .. tostring(payload.path)
		end
		return false, "Pfad nicht gefunden: " .. tostring(payload.path)
	elseif kind == "createTree" then
		local parent = resolve(payload.parentPath)
		if not parent then
			return false, "Elternobjekt nicht gefunden: " .. tostring(payload.parentPath)
		end
		local created = createFromNode(parent, payload.tree, payload.ifExists or "skip")
		if not created then
			return false, "Objekt konnte nicht erstellt werden"
		end
		return true, "Erstellt: " .. created:GetFullName()
	elseif kind == "createScript" then
		local instance, err = createScriptAt(payload.path, payload.scriptType, payload.source)
		if not instance then
			return false, err
		end
		return true, "Skript gesetzt: " .. instance:GetFullName()
	elseif kind == "setProperties" then
		local target = resolve(payload.path)
		if not target then
			return false, "Ziel nicht gefunden: " .. tostring(payload.path)
		end
		local changed = {}
		for key, value in pairs(payload.properties or {}) do
			local ok = pcall(function()
				applyValue(target, key, value)
			end)
			if ok then
				table.insert(changed, key)
			end
		end
		return true, "Eigenschaften gesetzt: " .. table.concat(changed, ", ")
	elseif kind == "selectInstance" then
		local target = resolve(payload.path)
		if target then
			Selection:Set({ target })
			return true, "Ausgewählt: " .. payload.path
		end
		return true, "Auswahl übersprungen"
	end
	return false, "Unbekannter Aktionstyp: " .. tostring(kind)
end

local function runActions(actions)
	local results = {}
	for _, action in ipairs(actions) do
		local recording = ChangeHistoryService:TryBeginRecording("Roblox Studio AI")
		local ok, message = pcall(executeAction, action)
		if recording then
			ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
		end
		table.insert(results, {
			id = action.id,
			ok = ok and true or false,
			message = tostring(message),
		})
		log((ok and "OK: " or "Fehler: ") .. tostring(action.summary or action.type))
	end
	if #results > 0 then
		request("POST", "/api/plugin/report", { token = state.token, results = results })
	end
	return results
end

/* ------------------------------------------------------------------ */
/*  Scan / Diagnose                                                   */
/* ------------------------------------------------------------------ */

local function gatherScan()
	local scripts = {}
	local parts = 0
	local unanchored = 0
	local models = 0
	local scriptCount = 0
	for _, descendant in ipairs(game:GetDescendants()) do
		if descendant:IsA("BasePart") then
			parts += 1
			if not descendant.Anchored then
				unanchored += 1
			end
		elseif descendant:IsA("Model") then
			models += 1
		end
		if descendant:IsA("LuaSourceContainer") then
			scriptCount += 1
			if scriptCount <= 400 then
				local ok, source = pcall(function()
					return descendant.Source
				end)
				table.insert(scripts, {
					path = descendant:GetFullName(),
					className = descendant.ClassName,
					lines = ok and select(2, string.gsub(source or "", "\n", "\n")) or 0,
					disabled = descendant:IsA("BaseScript") and descendant.Disabled or false,
				})
			end
		end
	end

	local logs = {}
	local ok, history = pcall(function()
		return LogService:GetLogHistory()
	end)
	if ok and type(history) == "table" then
		local startIndex = math.max(1, #history - 100)
		for index = startIndex, #history do
			local entry = history[index]
			if entry.messageType == Enum.MessageType.MessageError or entry.messageType == Enum.MessageType.MessageWarning then
				table.insert(logs, {
					message = entry.message,
					kind = entry.messageType.Name,
					at = entry.timestamp,
				})
			end
		end
	end

	return {
		placeName = game.Name,
		placeId = game.PlaceId,
		parts = parts,
		models = models,
		unanchoredParts = unanchored,
		scripts = scripts,
		logs = logs,
	}
end

local function sendScan()
	local ok, scan = pcall(gatherScan)
	if not ok then
		log("Scan fehlgeschlagen: " .. tostring(scan))
		return
	end
	local response, err = request("POST", "/api/plugin/scan", { token = state.token, scan = scan })
	if not response then
		log("Scan nicht gesendet: " .. tostring(err))
		return
	end
	log(string.format("Scan gesendet: %d Teile, %d Skripte, %d Meldungen", scan.parts, #scan.scripts, #scan.logs))
	if response.advice and #response.advice > 0 then
		for _, item in ipairs(response.advice) do
			log("Hinweis: " .. tostring(item.title))
		end
	end
end

/* ------------------------------------------------------------------ */
/*  Polling                                                           */
/* ------------------------------------------------------------------ */

local function poll()
	if not state.connected or state.polling then
		return
	end
	state.polling = true
	local response, err = request("POST", "/api/plugin/poll", {
		token = state.token,
		placeName = game.Name,
		placeId = game.PlaceId,
		studioVersion = tostring(game.PlaceVersion),
	})
	state.polling = false
	if not response then
		log("Verbindung verloren: " .. tostring(err))
		return
	end
	state.lastPoll = os.time()
	state.projectName = response.project and response.project.name or nil
	if projectLabel then
		projectLabel.Text = state.projectName or "Kein Projekt"
	end
	local actions = response.actions or {}
	if #actions > 0 then
		log(string.format("%d freigegebene Aktion(en) werden ausgeführt ...", #actions))
		runActions(actions)
	end
end

/* ------------------------------------------------------------------ */
/*  Oberfläche                                                        */
/* ------------------------------------------------------------------ */

local toolbar = plugin:CreateToolbar("Roblox Studio AI")
local button = toolbar:CreateButton("Roblox Studio AI", "KI-Spielgenerator öffnen", "rbxassetid://4458901886")

local widgetInfo = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 360, 460, 300, 320)
local widget = plugin:CreateDockWidgetPluginGui("RobloxStudioAIWidget", widgetInfo)
widget.Title = "Roblox Studio AI"
widget.Name = "RobloxStudioAI"

local frame = Instance.new("Frame")
frame.Size = UDim2.fromScale(1, 1)
frame.BackgroundColor3 = Color3.fromRGB(22, 24, 33)
frame.BorderSizePixel = 0
frame.Parent = widget

local function label(text, y, height, size)
	local item = Instance.new("TextLabel")
	item.Position = UDim2.fromOffset(12, y)
	item.Size = UDim2.new(1, -24, 0, height or 20)
	item.BackgroundTransparency = 1
	item.Text = text
	item.TextColor3 = Color3.fromRGB(232, 238, 250)
	item.TextXAlignment = Enum.TextXAlignment.Left
	item.Font = Enum.Font.Gotham
	item.TextSize = size or 13
	item.TextWrapped = true
	item.Parent = frame
	return item
end

local function field(placeholder, y, text)
	local box = Instance.new("TextBox")
	box.Position = UDim2.fromOffset(12, y)
	box.Size = UDim2.new(1, -24, 0, 30)
	box.BackgroundColor3 = Color3.fromRGB(34, 38, 50)
	box.BorderSizePixel = 0
	box.TextColor3 = Color3.fromRGB(240, 244, 255)
	box.PlaceholderText = placeholder
	box.Text = text or ""
	box.Font = Enum.Font.Code
	box.TextSize = 13
	box.ClearTextOnFocus = false
	box.Parent = frame
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 6)
	corner.Parent = box
	return box
end

local function actionButton(text, y, callback)
	local item = Instance.new("TextButton")
	item.Position = UDim2.fromOffset(12, y)
	item.Size = UDim2.new(1, -24, 0, 34)
	item.BackgroundColor3 = Color3.fromRGB(70, 120, 220)
	item.BorderSizePixel = 0
	item.Text = text
	item.TextColor3 = Color3.new(1, 1, 1)
	item.Font = Enum.Font.GothamBold
	item.TextSize = 14
	item.Parent = frame
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 8)
	corner.Parent = item
	item.MouseButton1Click:Connect(callback)
	return item
end

label("Roblox Studio AI", 12, 22, 17)
label("KI-Bridge für Spielgenerierung", 36, 18, 12)

local urlBox = field("Server-URL, z.B. https://meine-app.appjet.dev", 64, state.serverUrl)
local tokenBox = field("Projekt-Token (rsa_...)", 100, "")
label("Projekt", 138, 16, 12)
local projectLabel = label("Kein Projekt", 154, 18, 13)
local statusLabel = label("Nicht verbunden", 176, 18, 12)
logLabel = statusLabel

actionButton("Verbinden", 204, function()
	state.serverUrl = urlBox.Text
	state.token = tokenBox.Text
	if state.token == "" then
		log("Bitte Projekt-Token eintragen")
		return
	end
	plugin:SetSetting("RobloxStudioAI_Token", state.token)
	plugin:SetSetting("RobloxStudioAI_Server", state.serverUrl)
	state.connected = true
	log("Verbunden - warte auf freigegebene Aktionen")
	poll()
end)

actionButton("Trennen", 244, function()
	state.connected = false
	log("Verbindung getrennt")
end)

actionButton("Projekt scannen & Fehler senden", 284, function()
	if not state.connected then
		log("Bitte zuerst verbinden")
		return
	end
	task.spawn(sendScan)
end)

actionButton("Status aktualisieren", 324, function()
	if state.connected then
		task.spawn(poll)
	end
end)

label("Ablauf: In der Web-App Spiel beschreiben, Änderungen prüfen und freigeben. Das Plugin baut sie dann hier ein.", 366, 60, 12)

-- Token aus früheren Sitzungen laden
local savedToken = plugin:GetSetting("RobloxStudioAI_Token")
local savedServer = plugin:GetSetting("RobloxStudioAI_Server")
if type(savedToken) == "string" and savedToken ~= "" then
	tokenBox.Text = savedToken
	state.token = savedToken
end
if type(savedServer) == "string" and savedServer ~= "" then
	urlBox.Text = savedServer
	state.serverUrl = savedServer
end

button.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

task.spawn(function()
	while true do
		task.wait(3)
		if state.connected then
			pcall(poll)
		end
	end
end)
