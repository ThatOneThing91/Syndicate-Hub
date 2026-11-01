-- Plot Studio Diagnostic Capture
-- Read-only snapshot + temporary passive capture of plot build remotes.
-- It does not place, move, paint, group, or bulldoze anything.
-- Defaults match the recent test: source Plot3, destination Plot5.
-- Execute this, then for up to 3 minutes manually move ONE misaligned wall,
-- place ONE Shape (258/260 if available), and place ONE Barrel roof correctly.
-- Press "Finish + Copy Report" when done. The report is also saved locally.

local Players = game:GetService("Players")
local RS = game:GetService("ReplicatedStorage")
local Http = game:GetService("HttpService")
local UIS = game:GetService("UserInputService")
local CoreGui = game:GetService("CoreGui")
local player = Players.LocalPlayer
if not player then return end

local SOURCE_PLOT_NAME = "Plot3"
local TARGET_PLOT_NAME = "Plot5"
local BLUEPRINT_PATH = "SyndicateHub/SavedBases/festive.json"
local CAPTURE_SECONDS = 180
local MAX_REMOTE_CALLS = 80
local OUTPUT_PATH = "SyndicateHub/SavedBases/plotstudio_diagnostic.json"
local ENV = _G
pcall(function() if type(getgenv) == "function" then ENV = getgenv() end end)

local ENV_KEY = "__PlotStudioDiagnosticCapture"
if type(ENV[ENV_KEY]) == "function" then pcall(ENV[ENV_KEY]) end

local running = true
local captureActive = true
local capturedCalls = {}
local hookInstalled = false
local hookError = nil
local gui

local function log(message)
    print("[PlotStudio Diagnostic] " .. tostring(message))
end

local function pathOf(instance)
    local ok, value = pcall(function() return instance:GetFullName() end)
    return ok and value or tostring(instance)
end

local function serial(value, depth)
    depth = depth or 0
    local kind = typeof(value)
    if kind == "nil" or kind == "boolean" or kind == "number" or kind == "string" then
        return value
    elseif kind == "Vector3" then
        return {type="Vector3", x=value.X, y=value.Y, z=value.Z}
    elseif kind == "Vector2" then
        return {type="Vector2", x=value.X, y=value.Y}
    elseif kind == "CFrame" then
        return {type="CFrame", components={value:GetComponents()}}
    elseif kind == "Color3" then
        return {type="Color3", r=value.R, g=value.G, b=value.B}
    elseif kind == "EnumItem" then
        return tostring(value)
    elseif kind == "Instance" then
        return {type="Instance", class=value.ClassName, name=value.Name, path=pathOf(value)}
    elseif kind == "table" then
        if depth >= 4 then return "<depth-limit>" end
        local out, count = {}, 0
        for k, v in pairs(value) do
            count = count + 1
            if count > 50 then out._truncated = true; break end
            out[tostring(k)] = serial(v, depth + 1)
        end
        return out
    end
    return "<" .. kind .. ">"
end

local function safeAttribute(object, key)
    local ok, value = pcall(function() return object:GetAttribute(key) end)
    if ok and value ~= nil then return serial(value) end
end

local function plotOrigin(plot)
    if not plot then return nil end
    local x, y, z = plot:GetAttribute("OriginX"),
        plot:GetAttribute("OriginY"), plot:GetAttribute("OriginZ")
    local base = plot:FindFirstChild("Base")
    local floor = base and base:FindFirstChild("Floor")
    if type(x) == "number" and type(y) == "number" and type(z) == "number" then
        local sizeY = plot:GetAttribute("SizeY")
        if type(sizeY) == "number" then
            y = y + sizeY / 2
        elseif floor and floor:IsA("BasePart") then
            y = floor.Position.Y + floor.Size.Y / 2
        end
        local rotation = tonumber(plot:GetAttribute("RotationY")) or 0
        return CFrame.new(x, y, z) * CFrame.Angles(0, math.rad(rotation), 0)
    end
    if floor and floor:IsA("BasePart") then
        return CFrame.new(floor.Position + Vector3.new(0, floor.Size.Y / 2, 0))
            * (floor.CFrame - floor.CFrame.Position)
    end
    return nil
end

local ROOT_NAMES = {
    "Structures", "Floors", "Roofs", "Furniture", "Shapes",
    "Decorations", "Outdoor", "Shelves", "Doors"
}
local ATTR_NAMES = {
    "ItemId", "Category", "ItemCategory", "GUID", "Storey",
    "WallCFrame", "WallLength", "RoofStyle", "RoofPitch",
    "RoofHeight", "RoofSlope", "RoofWidth", "RoofDepth",
    "RoofLength", "RoofX", "RoofZ", "RoofRotation",
    "RoofOverhang", "RoofThickness", "Color", "PaintColor",
    "CustomColor", "Material", "CustomMaterial"
}

local function classify(rootName, object)
    local category = tostring(object:GetAttribute("Category")
        or object:GetAttribute("ItemCategory") or rootName)
    local id = object:GetAttribute("ItemId")
    local wallCf = object:GetAttribute("WallCFrame")
    local wallLength = object:GetAttribute("WallLength")
    if typeof(wallCf) == "CFrame" and type(wallLength) == "number" then return "Wall", category, id end
    if category == "Floors" or rootName == "Floors" or tostring(id or "") == "32" then
        return "Floor", category, id
    end
    if category == "Roofs" or rootName == "Roofs" or object:GetAttribute("RoofStyle") ~= nil
        or tostring(id or ""):match("^Roof_") then
        return "Roof", category, id
    end
    if id ~= nil then return "Item", category, id end
    return nil, category, id
end

local function inspectObject(rootName, object, plotOrigin, index)
    local kind, category, id = classify(rootName, object)
    local result = {
        index=index, root=rootName, kind=kind, name=object.Name,
        class=object.ClassName, path=pathOf(object), category=category,
        id=id ~= nil and tostring(id) or nil, attributes={}
    }
    for _, key in ipairs(ATTR_NAMES) do
        local value = safeAttribute(object, key)
        if value ~= nil then result.attributes[key] = value end
    end

    local okBox, boxCf, boxSize = pcall(function()
        if object:IsA("BasePart") then return object.CFrame, object.Size end
        return object:GetBoundingBox()
    end)
    if okBox and typeof(boxCf) == "CFrame" then
        result.boundsCFrame = serial(boxCf)
        result.boundsSize = serial(boxSize)
    end

    local effectiveCf
    if kind == "Wall" then
        effectiveCf = object:GetAttribute("WallCFrame")
    elseif kind == "Item" and object:IsA("Model") then
        local ok, pivot = pcall(function() return object:GetPivot() end)
        if ok then effectiveCf = pivot end
    elseif object:IsA("BasePart") then
        effectiveCf = object.CFrame
    else
        effectiveCf = boxCf
    end
    if typeof(effectiveCf) == "CFrame" then
        result.cframe = serial(effectiveCf)
        if plotOrigin then
            result.relativeCFrame = serial(plotOrigin:ToObjectSpace(effectiveCf))
        end
    end

    local partSamples, partCount = {}, 0
    local parts = object:IsA("BasePart") and {object} or object:GetDescendants()
    for _, part in ipairs(parts) do
        if part:IsA("BasePart") then
            partCount = partCount + 1
            if #partSamples < 12 then
                partSamples[#partSamples+1] = {
                    name=part.Name, size=serial(part.Size),
                    cframe=serial(part.CFrame), color=serial(part.Color),
                    material=tostring(part.Material), transparency=part.Transparency
                }
            end
        end
    end
    result.basePartCount = partCount
    if kind == "Wall" or kind == "Roof" or tostring(id) == "258" or tostring(id) == "260" then
        result.parts = partSamples
    end
    return result
end

local function inspectPlot(plot)
    if not plot then return {error="Plot not found"} end
    local origin = plotOrigin(plot)
    local snapshot = {
        name=plot.Name, path=pathOf(plot), origin=serial(origin),
        attributes={}, roots={}, objects={}
    }
    for _, key in ipairs({"OriginX","OriginY","OriginZ","SizeX","SizeY","SizeZ","RotationY","OwnerUserId","OwnerId","OwnerName","OwnerUsername"}) do
        local value = safeAttribute(plot, key)
        if value ~= nil then snapshot.attributes[key] = value end
    end
    local index = 0
    for _, rootName in ipairs(ROOT_NAMES) do
        local root = plot:FindFirstChild(rootName)
        if root then
            snapshot.roots[rootName] = #root:GetChildren()
            for _, object in ipairs(root:GetDescendants()) do
                local ancestor = object:FindFirstAncestorOfClass("Model")
                local topModel = object:IsA("Model") and
                    (not ancestor or not ancestor:IsDescendantOf(root))
                local standalone = object:IsA("BasePart") and
                    (not ancestor or not ancestor:IsDescendantOf(root))
                if topModel or standalone then
                    index = index + 1
                    if index <= 2500 then
                        snapshot.objects[#snapshot.objects+1] =
                            inspectObject(rootName, object, origin, index)
                    end
                end
            end
        end
    end
    snapshot.objectCount = index
    return snapshot
end

local function inspectBlueprint()
    if type(readfile) ~= "function" then return {error="Executor readfile unavailable"} end
    local ok, body = pcall(readfile, BLUEPRINT_PATH)
    if not ok or type(body) ~= "string" or body == "" then
        return {error="Could not read " .. BLUEPRINT_PATH}
    end
    local decoded, bp = pcall(function() return Http:JSONDecode(body) end)
    if not decoded or type(bp) ~= "table" or type(bp.parts) ~= "table" then
        return {error="Saved blueprint JSON could not be decoded"}
    end
    local out = {
        path=BLUEPRINT_PATH, name=bp.name, creator=bp.creator,
        sourcePlot=bp.sourcePlot, created=bp.created,
        storeyHeight=bp.storeyHeight, partCount=#bp.parts, parts={}
    }
    for i, part in ipairs(bp.parts) do
        local includeParts = part.kind == "Wall" or part.kind == "Roof"
            or part.kind == "Floor" or part.category == "Doors"
            or part.category == "Shapes"
            or tostring(part.id) == "258" or tostring(part.id) == "260"
        if includeParts then
            out.parts[#out.parts+1] = {
                index=i, kind=part.kind, id=part.id, category=part.category,
                name=part.name, level=part.lv, length=part.length,
                size=part.size, relativeCFrame=part.cf, color=part.color,
                material=part.material, finishParts=part.finishParts,
                style=part.style, roofSettings=part.roofSettings
            }
        end
    end
    return out
end

local function listPlotRemotes()
    local folder = RS:FindFirstChild("Events")
    folder = folder and folder:FindFirstChild("Plot")
    local found = {}
    if folder then
        for _, object in ipairs(folder:GetChildren()) do
            if object:IsA("RemoteEvent") or object:IsA("RemoteFunction") then
                found[#found+1] = {
                    name=object.Name, class=object.ClassName, path=pathOf(object)
                }
            end
        end
    end
    table.sort(found, function(a,b) return a.name < b.name end)
    return found
end

local function unpackCFrame(values)
    if type(values) ~= "table" then return nil end
    local components = values.components or values
    if type(components) ~= "table" or #components ~= 12 then return nil end
    local unpackValues = table.unpack or unpack
    if not unpackValues then return nil end
    local ok, cf = pcall(function() return CFrame.new(unpackValues(components)) end)
    return ok and cf or nil
end

local function compareBlueprintWalls(blueprint, targetSnapshot)
    local result = {}
    if type(blueprint) ~= "table" or type(blueprint.parts) ~= "table"
        or type(targetSnapshot) ~= "table" or type(targetSnapshot.objects) ~= "table" then
        return result
    end
    local plotFolder = workspace:FindFirstChild("_Plots")
    local targetPlot = plotFolder and plotFolder:FindFirstChild(TARGET_PLOT_NAME)
    local origin = plotOrigin(targetPlot)
    if not origin then return result end
    for _, expected in ipairs(blueprint.parts) do
        if expected.kind == "Wall" then
            local relative = unpackCFrame(expected.cf)
            local expectedCf = relative and origin * relative or nil
            local best, bestDistance = nil, math.huge
            if expectedCf then
                for _, actual in ipairs(targetSnapshot.objects) do
                    if actual.kind == "Wall" and
                        tostring(actual.id or "") == tostring(expected.id or "") then
                        local actualCf = unpackCFrame(actual.cframe)
                        if actualCf then
                            local distance = (expectedCf.Position - actualCf.Position).Magnitude
                            if distance < bestDistance then
                                bestDistance = distance
                                local dot = math.abs(expectedCf.RightVector:Dot(actualCf.RightVector))
                                local angle = math.deg(math.acos(math.clamp(dot, -1, 1)))
                                local actualLength = actual.attributes and actual.attributes.WallLength
                                best = {
                                    sourceIndex=expected.index, sourceId=expected.id,
                                    expectedLevel=expected.level,
                                    expectedLength=expected.length,
                                    actualLength=actualLength,
                                    lengthError=type(expected.length)=="number" and
                                        type(actualLength)=="number" and
                                        math.abs(expected.length-actualLength) or nil,
                                    centerErrorStuds=distance,
                                    angleErrorDegrees=angle,
                                    expectedCFrame=serial(expectedCf),
                                    actualCFrame=actual.cframe,
                                    actualPath=actual.path
                                }
                            end
                        end
                    end
                end
            end
            if best then
                result[#result+1] = best
            else
                result[#result+1] = {
                    sourceIndex=expected.index, sourceId=expected.id,
                    expectedLength=expected.length, error="No target wall with same item ID"
                }
            end
        end
    end
    return result
end

local function buildReport()
    local plotFolder = workspace:FindFirstChild("_Plots")
    local source = plotFolder and plotFolder:FindFirstChild(SOURCE_PLOT_NAME)
    local target = plotFolder and plotFolder:FindFirstChild(TARGET_PLOT_NAME)
    local sourceSnapshot = inspectPlot(source)
    local targetSnapshot = inspectPlot(target)
    local blueprint = inspectBlueprint()
    local report = {
        schema="plotstudio-diagnostic-1",
        timestamp=os.date("!%Y-%m-%dT%H:%M:%SZ"),
        placeId=game.PlaceId, jobId=game.JobId,
        player={name=player.Name, userId=player.UserId},
        sourcePlotName=SOURCE_PLOT_NAME, targetPlotName=TARGET_PLOT_NAME,
        hookInstalled=hookInstalled, hookError=hookError,
        capturedRemoteCalls=capturedCalls,
        availablePlotRemotes=listPlotRemotes(),
        sourcePlot=sourceSnapshot,
        targetPlot=targetSnapshot,
        savedBlueprint=blueprint,
        wallAlignment=compareBlueprintWalls(blueprint, targetSnapshot)
    }
    return report
end

local function saveReport()
    local report = buildReport()
    local okJson, body = pcall(function() return Http:JSONEncode(report) end)
    if not okJson then
        log("Could not encode diagnostic report: " .. tostring(body))
        return
    end
    if type(makefolder) == "function" then
        pcall(makefolder, "SyndicateHub")
        pcall(makefolder, "SyndicateHub/SavedBases")
    end
    local saved = false
    if type(writefile) == "function" then
        saved = pcall(writefile, OUTPUT_PATH, body)
    end
    local clipboard = type(setclipboard) == "function" and setclipboard
        or type(toclipboard) == "function" and toclipboard
    local copied = false
    if clipboard then copied = pcall(clipboard, body) end
    log("Report " .. (saved and ("saved to " .. OUTPUT_PATH) or "not saved locally")
        .. (copied and " and copied to clipboard." or "."))
    return body
end

local function finish()
    if not running then return end
    running = false
    captureActive = false
    if gui then pcall(function() gui:Destroy() end) end
    saveReport()
end

-- Capture actual editor calls passively. Each original call still runs unchanged.
local watched = {
    PlaceWall=true, PlaceItem=true, PlaceShapeGroup=true, GroupShapes=true,
    UngroupShapes=true, PlaceRoof=true, MoveItem=true, MoveGroup=true,
    PaintWallSide=true, ColorItem=true, MaterialItem=true, PlaceWindow=true
}
local plotEvents = RS:FindFirstChild("Events")
plotEvents = plotEvents and plotEvents:FindFirstChild("Plot")
local function serializeArgs(...)
    local count = select("#", ...)
    local out = {argumentCount=count, values={}}
    for i = 1, math.min(count, 20) do
        local value = select(i, ...)
        out.values[i] = {index=i, value=value == nil and {type="nil"} or serial(value)}
    end
    if count > 20 then out.truncated=true end
    return out
end

if type(hookmetamethod) == "function" and
    type(getnamecallmethod) == "function" and type(newcclosure) == "function" then
    local oldNamecall
    local ok, err = pcall(function()
        oldNamecall = hookmetamethod(game, "__namecall", newcclosure(function(self, ...)
            local method = getnamecallmethod()
            if captureActive and method == "FireServer" and #capturedCalls < MAX_REMOTE_CALLS then
                local isPlotRemote = false
                if typeof(self) == "Instance" and self:IsA("RemoteEvent")
                    and self.Parent == plotEvents and watched[self.Name] then
                    isPlotRemote = true
                end
                if isPlotRemote then
                    capturedCalls[#capturedCalls+1] = {
                        time=os.date("!%H:%M:%S"),
                        remote=self.Name, path=pathOf(self), args=serializeArgs(...)
                    }
                    log("Captured " .. self.Name .. " call (" .. #capturedCalls .. "/" .. MAX_REMOTE_CALLS .. ")")
                end
            end
            return oldNamecall(self, ...)
        end))
    end)
    hookInstalled = ok and type(oldNamecall) == "function"
    if not hookInstalled then hookError = tostring(err) end
else
    hookError = "This executor does not expose hookmetamethod/getnamecallmethod/newcclosure."
end

local uiParent
if type(gethui) == "function" then
    pcall(function() uiParent = gethui() end)
end
if not uiParent then
    pcall(function() uiParent = CoreGui end)
end
if not uiParent then uiParent = player:WaitForChild("PlayerGui") end

local okGui, guiResult = pcall(function()
    local screen = Instance.new("ScreenGui")
    screen.Name = "PlotStudioDiagnostic"
    screen.ResetOnSpawn = false
    screen.DisplayOrder = 10050
    screen.Parent = uiParent
    local panel = Instance.new("Frame")
    panel.Size = UDim2.fromOffset(235, 92)
    panel.Position = UDim2.new(1, -250, 0, 80)
    panel.BackgroundColor3 = Color3.fromRGB(22, 19, 31)
    panel.BorderSizePixel = 0
    panel.Parent = screen
    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, 8)
    corner.Parent = panel
    local title = Instance.new("TextLabel")
    title.BackgroundTransparency = 1
    title.Position = UDim2.fromOffset(8, 3)
    title.Size = UDim2.new(1, -16, 0, 22)
    title.Font = Enum.Font.GothamBold
    title.TextSize = 12
    title.TextColor3 = Color3.fromRGB(235, 226, 255)
    title.Text = hookInstalled and "Plot diagnostics: capturing" or "Plot diagnostics: snapshot only"
    title.Parent = panel
    local button = Instance.new("TextButton")
    button.Position = UDim2.fromOffset(8, 29)
    button.Size = UDim2.new(1, -16, 0, 27)
    button.BackgroundColor3 = Color3.fromRGB(153, 103, 239)
    button.TextColor3 = Color3.fromRGB(20, 17, 28)
    button.Font = Enum.Font.GothamBold
    button.TextSize = 12
    button.Text = "FINISH + COPY REPORT"
    button.Parent = panel
    local bc = Instance.new("UICorner")
    bc.CornerRadius = UDim.new(0, 6)
    bc.Parent = button
    button.Activated:Connect(finish)
    local hint = Instance.new("TextLabel")
    hint.BackgroundTransparency = 1
    hint.Position = UDim2.fromOffset(8, 59)
    hint.Size = UDim2.new(1, -16, 0, 28)
    hint.Font = Enum.Font.Gotham
    hint.TextSize = 9
    hint.TextWrapped = true
    hint.TextColor3 = Color3.fromRGB(175, 166, 195)
    hint.Text = "Move one bad wall, then test one Shape and the Barrel roof."
    hint.Parent = panel
    return screen
end)
if okGui then gui = guiResult end

ENV[ENV_KEY] = finish
log("Read-only snapshot ready for " .. SOURCE_PLOT_NAME .. " -> " .. TARGET_PLOT_NAME .. ".")
log("Blueprint path: " .. BLUEPRINT_PATH)
if hookInstalled then
    log("For 3 minutes, manually move one bad wall, place one Shape 258/260, and place one Barrel roof.")
else
    log("Remote-call capture unavailable; snapshot will still include plots, blueprint, and remote names.")
end

task.spawn(function()
    local elapsed = 0
    while running and elapsed < CAPTURE_SECONDS do
        task.wait(1)
        elapsed = elapsed + 1
    end
    if running then finish() end
end)


