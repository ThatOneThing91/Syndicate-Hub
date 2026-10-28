--[[
    PLOT STUDIO | Storage Hunters
    Standalone Plot Studio v2.3: live plot repair snapshots, verified Shape diagnostics and optional roof cap
    Previews are local; confirmed build actions can place permanent parts.
    The blueprint library is a catalog mockup, not loaded models.
]]

local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local TweenService = game:GetService("TweenService")
local CoreGui = game:GetService("CoreGui")
local player = Players.LocalPlayer
if not player then return end

local env = _G
pcall(function()
    if type(getgenv) == "function" then env = getgenv() end
end)
local KEY = "__StorageHunters_PlotStudio"
local NAME = "StorageHunters_PlotStudio"

if type(env[KEY]) == "function" then pcall(env[KEY]) end
for _, parent in ipairs({CoreGui, player:WaitForChild("PlayerGui")}) do
    local old = parent:FindFirstChild(NAME)
    if old then old:Destroy() end
end

local gui = Instance.new("ScreenGui")
gui.Name = NAME
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.DisplayOrder = 10000
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling

local parentOK = false
if type(gethui) == "function" then
    parentOK = pcall(function() gui.Parent = gethui() end)
end
if not parentOK then
    parentOK = pcall(function() gui.Parent = CoreGui end)
end
if not parentOK then gui.Parent = player:WaitForChild("PlayerGui") end

local alive, connections = true, {}
local function on(signal, fn)
    local c = signal:Connect(fn)
    connections[#connections + 1] = c
    return c
end
local function ui(class, props, parent)
    local obj = Instance.new(class)
    for key, value in pairs(props or {}) do obj[key] = value end
    if parent then obj.Parent = parent end
    return obj
end
local function corner(obj, radius)
    ui("UICorner", {CornerRadius = UDim.new(0, radius or 10)}, obj)
    return obj
end
local function border(obj, color, thickness, alpha)
    ui("UIStroke", {Color = color or Color3.fromRGB(57, 59, 76), Thickness = thickness or 1, Transparency = alpha or 0}, obj)
    return obj
end
local C = {
    bg = Color3.fromRGB(11, 13, 22),
    panel = Color3.fromRGB(18, 21, 32),
    raised = Color3.fromRGB(27, 30, 44),
    raised2 = Color3.fromRGB(34, 36, 54),
    line = Color3.fromRGB(53, 55, 76),
    white = Color3.fromRGB(241, 240, 255),
    dim = Color3.fromRGB(154, 154, 178),
    muted = Color3.fromRGB(105, 107, 136),
    purple = Color3.fromRGB(163, 112, 255),
    purpleDark = Color3.fromRGB(73, 49, 125),
    mint = Color3.fromRGB(92, 215, 184),
    orange = Color3.fromRGB(252, 190, 112),
    red = Color3.fromRGB(246, 113, 136),
}
local function text(parent, value, x, y, w, h, size, color, bold, extra)
    local p = {
        BackgroundTransparency = 1, BorderSizePixel = 0,
        Position = UDim2.fromOffset(x or 0, y or 0),
        Size = UDim2.new(w or 1, type(w) == "number" and 0 or -0, 0, h or 24),
        Text = value or "", TextSize = size or 14,
        Font = bold and Enum.Font.GothamBold or Enum.Font.Gotham,
        TextColor3 = color or C.white, TextXAlignment = Enum.TextXAlignment.Left,
        TextYAlignment = Enum.TextYAlignment.Center,
        TextTruncate = Enum.TextTruncate.AtEnd,
    }
    if type(w) == "number" then p.Size = UDim2.new(0, w, 0, h or 24) end
    for k, v in pairs(extra or {}) do p[k] = v end
    return ui("TextLabel", p, parent)
end
local function button(parent, title, x, y, width, height, primary, fn)
    local b = corner(ui("TextButton", {
        Name = "Action",
        BackgroundColor3 = primary and C.purple or C.raised2,
        BorderSizePixel = 0,
        Position = UDim2.fromOffset(x, y),
        Size = UDim2.fromOffset(width, height or 34),
        AutoButtonColor = true,
        Text = title, TextSize = 12,
        Font = Enum.Font.GothamBold,
        TextColor3 = primary and C.bg or C.white,
    }, parent), 8)
    on(b.MouseButton1Click, function() if alive and fn then fn() end end)
    return b
end

local materials = {
    "Wood", "WoodPlanks", "Slate", "RoofShingles", "ClayRoofTiles", "Metal",
    "CorrodedMetal", "DiamondPlate", "Concrete", "Brick", "Cobblestone", "Granite",
    "Marble", "Limestone", "Sandstone", "Basalt", "Pebble", "Sand", "Grass",
    "Ground", "Mud", "Snow", "Asphalt", "Plaster", "CeramicTiles", "Cardboard",
    "Fabric", "SmoothPlastic", "Neon", "Ice", "Glass"
}
local designs = {
    {name = "Grand Citadel", category = "CASTLES", floors = 5, subtitle = "Open courtyard / curved arcades / rear palace", tag = "FEATURED"},
    {name = "Blackstone Fortress", category = "CASTLES", floors = 4, subtitle = "Open court / crescent stone wings / rear bastion", tag = "CONCEPT"},
    {name = "Royal Courtyard", category = "CASTLES", floors = 3, subtitle = "Symmetrical wings  /  central garden", tag = "CONCEPT"},
    {name = "Glass Showroom", category = "MODERN", floors = 2, subtitle = "Bright storefront  /  display-ready interiors", tag = "CONCEPT"},
    {name = "Watchtower Outpost", category = "UTILITY", floors = 2, subtitle = "Compact tower  /  rooftop lookout", tag = "CONCEPT"},
}
local swatches = {
    {Color3.fromRGB(163,112,255), "Amethyst"},
    {Color3.fromRGB(236,236,239), "Snow white"},
    {Color3.fromRGB(96,99,110), "Slate gray"},
    {Color3.fromRGB(34,35,41), "Obsidian"},
    {Color3.fromRGB(203,162,109), "Sand gold"},
    {Color3.fromRGB(157,66,77), "Burgundy"},
    {Color3.fromRGB(81,164,153), "Seafoam"},
    {Color3.fromRGB(99,136,211), "Royal blue"},
}
local state = {
    page = "Overview", filter = "ALL", design = 1,
    material = "Cobblestone", color = swatches[1][1], colorName = "Amethyst",
    floors = 5, grid = true, confirm = true, notifications = true, compact = false,
    buildSpeed = "Steady", autoStyle = true, advancedBuilder = false,
}

local viewport = workspace.CurrentCamera and workspace.CurrentCamera.ViewportSize or Vector2.new(1280, 720)
local width = math.floor(math.max(330, math.min(910, viewport.X - 26)))
local height = math.floor(math.max(390, math.min(600, viewport.Y - 34)))
local win = corner(ui("Frame", {
    Name = "StudioWindow", BackgroundColor3 = C.bg, BorderSizePixel = 0,
    Size = UDim2.fromOffset(width, height),
    Position = UDim2.fromOffset(math.floor((viewport.X-width)/2), math.floor((viewport.Y-height)/2)),
    ClipsDescendants = true,
}, gui), 15)
border(win, C.purpleDark, 1.5, 0.1)

local header = ui("Frame", {
    BackgroundColor3 = C.panel, BorderSizePixel = 0,
    Size = UDim2.new(1, 0, 0, 68),
}, win)
ui("UIGradient", {
    Color = ColorSequence.new({
        ColorSequenceKeypoint.new(0, Color3.fromRGB(39, 27, 65)),
        ColorSequenceKeypoint.new(0.55, C.panel),
        ColorSequenceKeypoint.new(1, C.panel),
    }), Rotation = 0
}, header)
local emblem = corner(ui("Frame", {
    Position = UDim2.fromOffset(16, 15), Size = UDim2.fromOffset(38, 38),
    BackgroundColor3 = C.purple, BorderSizePixel = 0,
}, header), 10)
text(emblem, "P", 0, 0, 38, 38, 22, C.bg, true, {TextXAlignment = Enum.TextXAlignment.Center})
text(header, "PLOT STUDIO  V2.3", 65, 12, 285, 25, 19, C.white, true)
text(header, "STORAGE HUNTERS  /  BLUEPRINT LAB", 65, 36, 280, 17, 10, C.dim, false)
local headerStatus = corner(ui("Frame", {
    AnchorPoint = Vector2.new(1, 0.5),
    Position = UDim2.new(1, -112, 0.5, 0),
    Size = UDim2.fromOffset(102, 25),
    BackgroundColor3 = C.purpleDark, BorderSizePixel = 0,
}, header), 12)
text(headerStatus, "●  V2.3 BETA", 8, 0, 92, 25, 10, C.white, true)

local minus = button(header, "—", 0, 0, 32, 30, false, nil)
minus.AnchorPoint = Vector2.new(1, 0.5)
minus.Position = UDim2.new(1, -52, 0.5, 0)
local close = button(header, "×", 0, 0, 32, 30, false, nil)
close.AnchorPoint = Vector2.new(1, 0.5)
close.Position = UDim2.new(1, -13, 0.5, 0)
close.TextSize = 20

local sidebar = ui("Frame", {
    BackgroundColor3 = C.panel, BorderSizePixel = 0,
    Position = UDim2.fromOffset(0, 69),
    Size = UDim2.new(0, 185, 1, -102),
}, win)
ui("Frame", {
    BackgroundColor3 = C.line, BorderSizePixel = 0,
    Position = UDim2.new(1, -1, 0, 0), Size = UDim2.new(0, 1, 1, 0)
}, sidebar)
text(sidebar, "WORKSPACE", 16, 20, 150, 18, 10, C.muted, true)

local navSpecs = {
    {"Overview", "01"},
    {"Blueprints", "02"},
    {"Builder", "03"},
    {"Catalog", "04"},
    {"Materials", "05"},
    {"Settings", "06"}
}
local navButtons = {}
local renderPage, switchPage, modal
for i, data in ipairs(navSpecs) do
    local b = corner(ui("TextButton", {
        Name = data[1], BackgroundColor3 = C.panel, BorderSizePixel = 0,
        Position = UDim2.new(0, 9, 0, 48 + (i-1)*50),
        Size = UDim2.new(1, -18, 0, 42),
        Text = "", AutoButtonColor = false,
    }, sidebar), 9)
    text(b, data[2], 12, 0, 29, 42, 12, C.purple, true)
    local lbl = text(b, data[1], 42, 0, 110, 42, 12, C.dim, true)
    navButtons[data[1]] = {button=b, label=lbl}
    on(b.MouseButton1Click, function() if switchPage then switchPage(data[1]) end end)
end
local sidebarBottom = text(sidebar, "V2.3  •  PLOT STUDIO", 15, 0, 164, 18, 10, C.muted, true)
sidebarBottom.AnchorPoint = Vector2.new(0,1)
sidebarBottom.Position = UDim2.new(0,15,1,-16)

local content = ui("Frame", {
    Name = "Content", BackgroundTransparency = 1,
    Position = UDim2.fromOffset(185, 69),
    Size = UDim2.new(1, -185, 1, -105),
}, win)
local footer = ui("Frame", {
    BackgroundColor3 = C.panel, BorderSizePixel = 0,
    Position = UDim2.new(0,0,1,-33), Size = UDim2.new(1,0,0,33),
}, win)
ui("Frame", {BackgroundColor3=C.line, BorderSizePixel=0, Size=UDim2.new(1,0,0,1)}, footer)
local footLabel = text(footer, "●  PREVIEW IS LOCAL  ·  CONFIRMED BUILDS CHANGE YOUR PLOT", 13, 3, 510, 30, 10, C.mint, true)
local resize = ui("TextButton", {
    BackgroundTransparency=1, Text="◢", Font=Enum.Font.GothamBold,
    TextColor3=C.muted, TextSize=20, AnchorPoint=Vector2.new(1,1),
    Position=UDim2.new(1,-2,1,-2), Size=UDim2.fromOffset(30,30),
}, win)
local toast = corner(ui("Frame", {
    BackgroundColor3 = C.raised2, BorderSizePixel = 0,
    AnchorPoint = Vector2.new(0.5,1), Position = UDim2.new(0.5,0,1,-44),
    Size = UDim2.new(1,-65,0,40), Visible = false, ZIndex = 20,
}, win), 10)
border(toast,C.purple,1,0.25)
local toastText = text(toast,"",14,0,400,40,12,C.white,true,{ZIndex=21})
toastText.Size = UDim2.new(1,-26,1,0)
local noticeNumber = 0
local function notify(message)
    footLabel.Text = "●  "..message
    if not state.notifications then return end
    noticeNumber = noticeNumber + 1
    local id = noticeNumber
    toastText.Text = message
    toast.Visible = true
    task.delay(3.1, function()
        if alive and id == noticeNumber then toast.Visible = false end
    end)
end


-- Client-only architectural previews. No remote calls and no changes to saved plots.
local PREVIEW_NAME = "StorageHunters_PlotStudio_LocalPreview"
local previewFolder = nil
local function clearPreview(silent)
    if previewFolder then pcall(function() previewFolder:Destroy() end); previewFolder=nil end
    local old=workspace:FindFirstChild(PREVIEW_NAME)
    if old then pcall(function() old:Destroy() end) end
    if not silent then notify("3D preview cleared") end
end
clearPreview(true)


local function plotOwner(plot)
    local id=plot:GetAttribute("OwnerUserId")
    if type(id)=="number" and id>0 then return id==player.UserId end
    local name=plot:GetAttribute("OwnerName") or plot:GetAttribute("OwnerUsername")
    if type(name)=="string" and name~="" then return name:lower()==player.Name:lower() end
    local board=plot:FindFirstChild("OwnerHeadshot",true)
    local value=board and board:FindFirstChild("OwnerName",true)
    if value then
        if value:IsA("StringValue") then name=value.Value
        elseif value:IsA("TextLabel") or value:IsA("TextButton") then name=value.Text
        else name=value:GetAttribute("Value") end
        if type(name)=="string" and name~="" then
            return name:lower():find(player.Name:lower(),1,true)~=nil
        end
    end
    return false
end
local function ownedPlot()
    local plots=workspace:FindFirstChild("_Plots")
    if not plots then return nil end
    for _,plot in ipairs(plots:GetChildren()) do
        if plotOwner(plot) then return plot end
    end
    return nil
end
local function plotFrame(plot)
    if not plot then return nil end
    local base=plot:FindFirstChild("Base")
    local floor=base and base:FindFirstChild("Floor")
    local x,y,z=plot:GetAttribute("OriginX"),plot:GetAttribute("OriginY"),plot:GetAttribute("OriginZ")
    if type(x)=="number" and type(y)=="number" and type(z)=="number" then
        local sy=plot:GetAttribute("SizeY")
        if type(sy)=="number" then y=y+sy/2
        elseif floor and floor:IsA("BasePart") then y=floor.Position.Y+floor.Size.Y/2 end
        return CFrame.new(x,y,z)*CFrame.Angles(0,math.rad(plot:GetAttribute("RotationY") or 0),0)
    end
    if floor and floor:IsA("BasePart") then
        return CFrame.new(floor.Position+Vector3.new(0,floor.Size.Y/2,0))*(floor.CFrame-floor.CFrame.Position)
    end
    return nil
end
local function teleportPlotCenter()
    local plot=ownedPlot()
    local frame=plot and plotFrame(plot)
    local char=player.Character
    local root=char and char:FindFirstChild("HumanoidRootPart")
    if not frame or not root then
        notify("Your plot or character is unavailable")
        return
    end
    local target=frame.Position+Vector3.new(0,5,0)
    local ray=workspace:Raycast(target+Vector3.new(0,30,0),Vector3.new(0,-80,0))
    if ray and ray.Position.Y>frame.Position.Y-3 and ray.Position.Y<frame.Position.Y+7 then
        target=Vector3.new(target.X,ray.Position.Y+4,target.Z)
    end
    root.CFrame=CFrame.new(target)*CFrame.Angles(0,math.rad(plot:GetAttribute("RotationY") or 0),0)
    notify("Teleported to your plot center")
end

local function previewFrame()
    local owned=ownedPlot()
    local f=plotFrame(owned)
    if f then return f,"Owned plot: "..owned.Name end
    local hrp=player.Character and player.Character:FindFirstChild("HumanoidRootPart")
    local plots=workspace:FindFirstChild("_Plots")
    if hrp and plots then
        local best,distance
        for _,p in ipairs(plots:GetChildren()) do
            local cf=plotFrame(p)
            if cf then
                local d=(Vector3.new(cf.Position.X,0,cf.Position.Z)-Vector3.new(hrp.Position.X,0,hrp.Position.Z)).Magnitude
                if not distance or d<distance then best=cf;distance=d end
            end
        end
        if best and distance<180 then return best,"Nearest plot (preview only; owner not verified)" end
    end
    if hrp then
        local c=hrp.Position+hrp.CFrame.LookVector*35
        return CFrame.new(c.X,hrp.Position.Y-3,c.Z),"Near character (preview only)"
    end
    return nil,"No position"
end
-- Plot Studio v0.4: architectural previews scaled to the available plot.
local lastFootprint="Not measured"
local function getFootprint(plot)
    local width,depth,reason
    local function attr(keys)
        if not plot then return nil end
        for _,key in ipairs(keys) do
            local n=plot:GetAttribute(key)
            if type(n)=="number" and n>=60 and n<=300 then return n end
        end
    end
    width=attr({"FullSizeX","SizeX","PlotSizeX","Width"})
    depth=attr({"FullSizeZ","SizeZ","PlotSizeZ","Depth"})
    if width and depth then reason="Plot attributes" end
    local base=plot and plot:FindFirstChild("Base")
    local floorPart=base and base:FindFirstChild("Floor")
    if floorPart and floorPart:IsA("BasePart") then
        width=width or floorPart.Size.X
        depth=depth or floorPart.Size.Z
        if not reason then reason="Base.Floor" end
    end
    -- Do not cap a fully upgraded plot at 171 studs. Retain a small
    -- margin so real server placements remain inside the owned base.
    width=math.clamp((width or 180)*.91,64,270)
    depth=math.clamp((depth or 180)*.91,64,270)
    lastFootprint=string.format("%d x %d studs / %s",math.floor(width+.5),math.floor(depth+.5),reason or "180-stud estimate")
    return width,depth
end


-- Curated by design identity; no globally applied glass/material selection.
local DESIGN_STYLES={
    [1]={name="Royal Amethyst",wall="Limestone",tower="Granite",floor="Marble",
        accent="Basalt",roof="Slate",trim="Marble",wood="WoodPlanks",metal="Metal",
        wallColor=Color3.fromRGB(197,191,180),towerColor=Color3.fromRGB(124,127,139),
        floorColor=Color3.fromRGB(211,207,197),accentColor=Color3.fromRGB(59,53,81),
        roofColor=Color3.fromRGB(80,62,111),trimColor=Color3.fromRGB(225,207,158)},
    [2]={name="Blackstone Gothic",wall="Basalt",tower="Cobblestone",floor="Slate",
        accent="CorrodedMetal",roof="RoofShingles",trim="Granite",wood="WoodPlanks",metal="CorrodedMetal",
        wallColor=Color3.fromRGB(76,78,86),towerColor=Color3.fromRGB(57,61,68),
        floorColor=Color3.fromRGB(105,108,114),accentColor=Color3.fromRGB(36,34,46),
        roofColor=Color3.fromRGB(76,33,48),trimColor=Color3.fromRGB(169,163,157)},
    [3]={name="Ivory Palace",wall="Marble",tower="Limestone",floor="CeramicTiles",
        accent="Granite",roof="ClayRoofTiles",trim="Plaster",wood="WoodPlanks",metal="Metal",
        wallColor=Color3.fromRGB(235,221,195),towerColor=Color3.fromRGB(219,208,189),
        floorColor=Color3.fromRGB(231,222,207),accentColor=Color3.fromRGB(136,100,75),
        roofColor=Color3.fromRGB(150,90,57),trimColor=Color3.fromRGB(255,238,195)},
    [4]={name="Azure Atrium",wall="Concrete",tower="Metal",floor="Marble",
        accent="Metal",roof="Slate",trim="SmoothPlastic",wood="WoodPlanks",metal="Metal",
        wallColor=Color3.fromRGB(185,193,205),towerColor=Color3.fromRGB(97,111,132),
        floorColor=Color3.fromRGB(219,224,230),accentColor=Color3.fromRGB(72,94,119),
        roofColor=Color3.fromRGB(55,69,85),trimColor=Color3.fromRGB(115,178,209)},
    [5]={name="Ancient Watchtower",wall="Cobblestone",tower="Basalt",floor="WoodPlanks",
        accent="CorrodedMetal",roof="RoofShingles",trim="Granite",wood="WoodPlanks",metal="Metal",
        wallColor=Color3.fromRGB(148,144,134),towerColor=Color3.fromRGB(93,96,98),
        floorColor=Color3.fromRGB(161,122,84),accentColor=Color3.fromRGB(63,69,76),
        roofColor=Color3.fromRGB(80,78,77),trimColor=Color3.fromRGB(195,183,147)}
}

local function beginPreview()
    clearPreview(true)
    local origin,where=previewFrame()
    if not origin then notify("No plot or player position for preview");return end
    local w,d=getFootprint(ownedPlot())
    local selected=designs[state.design]
    if not selected then return end
    local cfg
    pcall(function() cfg=require(game:GetService("ReplicatedStorage").Modules.PlotConfig) end)
    local h=cfg and cfg.StoreyHeight or 15
    if type(h)~="number" or h<6 or h>30 then h=15 end
    local floors=math.min(state.floors,selected.floors)
    local profile=DESIGN_STYLES[state.design] or DESIGN_STYLES[1]
    local primary=state.autoStyle and profile.roofColor or state.color
    local stone=state.autoStyle and profile.wallColor or state.color
    local light=state.autoStyle and profile.trimColor or Color3.fromRGB(225,220,233)
    local dark=state.autoStyle and profile.towerColor or state.color
    local gold=Color3.fromRGB(229,178,100)
    local glass=Color3.fromRGB(85,174,221)
    local roof=state.autoStyle and profile.roofColor or state.color
    local mat=Enum.Material.Slate
    previewFolder=Instance.new("Folder")
    previewFolder.Name=PREVIEW_NAME
    previewFolder.Parent=workspace
    local count=0
    local currentZone=nil
    -- Explicit kind is vital: decorations must never be interpreted as wall requests.
    local function part(name,kind,x,y,z,sx,sy,sz,rot,color)
        if count>=1550 then return end
        if math.min(sx,sy,sz)<.1 then return end
        local p=Instance.new("Part")
        p.Name=name;p.Anchored=true;p.CanCollide=false;p.CanQuery=false
        p.CanTouch=false;p.CastShadow=false
        local key=name:lower()
        local chosen,shade=profile.wall,profile.wallColor
        if kind=="Glass" then
            chosen="Glass";shade=glass
        elseif key:find("banner") or key:find("flag") then
            chosen="Fabric";shade=primary
        elseif key:find("gate rod") or key:find("portcullis") or
            key:find("iron") or key:find("gilded") or key:find("gold") then
            chosen=profile.metal;shade=gold
        elseif key:find("lantern") then
            chosen="Neon";shade=gold
        elseif key:find("stair tread") then
            chosen=profile.floor;shade=profile.floorColor
        elseif key:find("balustrade") or key:find("railing") or key:find("door") then
            chosen=profile.wood;shade=profile.floorColor
        elseif key:find("spire") or key:find("roof") then
            chosen=profile.roof;shade=profile.roofColor
        elseif key:find("column") or key:find("cornice") or key:find("capital") or
            key:find("lintel") or key:find("battlement") or key:find("keystone") then
            chosen=profile.trim;shade=profile.trimColor
        elseif key:find("turret") or key:find("tower") or key:find("rampart")
            or key:find("buttress") then
            chosen=profile.tower;shade=profile.towerColor
        elseif kind=="Floor" or key:find("terrace") or key:find("promenade") then
            chosen=profile.floor;shade=profile.floorColor
        elseif color==dark then
            chosen=profile.accent;shade=profile.accentColor
        elseif color==light then
            chosen=profile.trim;shade=profile.trimColor
        elseif color==gold then
            chosen=profile.metal;shade=gold
        end
        if not state.autoStyle and kind~="Glass" then
            chosen=state.material
            shade=color or state.color
        end
        p.Material=Enum.Material[chosen] or mat
        p.Color=shade
        p:SetAttribute("PlotStudioMaterial",chosen)
        p:SetAttribute("PlotStudioColor",shade)
        p.Transparency=kind=="Glass" and .40 or (kind=="Decor" and .28 or .14)
        if name=="Stair tread" or name=="Stair landing" then
            local function snap(v) return math.floor(v*4+.5)/4 end
            x=snap(x);y=snap(y);z=snap(z)
            sx=math.max(.25,snap(sx));sy=math.max(.25,snap(sy));sz=math.max(.25,snap(sz))
        end
        p.Size=Vector3.new(sx,sy,sz)
        p.CFrame=origin*CFrame.new(x,y,z)*CFrame.Angles(0,rot or 0,0)
        p:SetAttribute("PlotStudioKind",kind)
        if currentZone then p:SetAttribute("PlotStudioZone",currentZone) end
        p.Parent=previewFolder
        local e=Instance.new("SelectionBox")
        e.Adornee=p;e.Color3=kind=="Glass" and glass or (kind=="Decor" and light or C.purple)
        e.LineThickness=kind=="Decor" and .04 or .075
        e.Transparency=.08;e.SurfaceTransparency=1;e.Parent=p
        count=count+1
        return p
    end
    local function deco(name,x,y,z,sx,sy,sz,col,rot)
        return part(name,"Decor",x,y,z,sx,sy,sz,rot,col)
    end
    local function wall(name,x,y,z,len,height,rot,col)
        return part(name,"Wall",x,y,z,len,height,.65,rot,col)
    end
    local function deck(name,x,y,z,sx,sz,col)
        return part(name,"Floor",x,y,z,sx,.55,sz,nil,col)
    end
    local function nativeRoof(name,x,z,sx,sz,top,style)
        -- Preview-only marker for ONE actual PlaceRoof request, not a
        -- decorative Shape pretending to be a real roof.
        local p=part(name,"Roof",x,top+.25,z,sx,.5,sz,nil,roof)
        if p then
            p:SetAttribute("PlotStudioRoofStyle",style or "Hip")
            p.Transparency=.23
        end
        return p
    end
    -- Native window models belong to the game's Windows category and must
    -- snap to a *server-created* wall GUID. A fake glass preview would be
    -- misleading: it neither creates a real window nor opens the wall.
    -- Do not synthesize stained-glass panels or window trim here.
    local function glaze(x,y,z,sx,sy,rot)
        return nil
    end
    local function crenels(x,z,len,y,rot)
        -- Battlements are decorative Shapes. PlaceWall cannot faithfully
        -- produce a 2.3-stud crenel; it creates a full-height wall instead.
        deco("Carved battlement base",x,y,z,len,2.3,.75,dark,rot)
        local n=math.max(2,math.floor(len/5))
        for j=1,n do
            local off=(j-.5)*len/n-len/2
            deco("Battlement",x+math.cos(rot)*off,y+2.1,z-math.sin(rot)*off,len/n*.57,2.5,1.5,light,rot)
        end
    end
    local function openings(x,z,len,level,rot)
        if level==0 then return end
        local n=math.max(1,math.floor((len-7)/12))
        for j=1,n do
            local off=(j-(n+1)/2)*len/(n+1)
            local px=x+math.cos(rot)*off
            local pz=z-math.sin(rot)*off
            local y=level*h+h*.57
            -- Intentionally empty: native Windows are installed only
            -- after their target structural walls have real GUIDs.
            -- Window placement is a separate, validated construction stage.
        end
    end
    local function walls(cx,cz,wx,dz,lv,col,entry)
        local cy=lv*h+h/2
        wall("North wall",cx,cy,cz+dz/2,wx,h,0,col)
        wall("West wall",cx-wx/2,cy,cz,dz,h,math.pi/2,col)
        wall("East wall",cx+wx/2,cy,cz,dz,h,math.pi/2,col)
        if entry then
            -- A real opening in every storey, not glass or bars blocking the door.
            local open=math.clamp(wx*.20,8,16)
            local chunk=(wx-open)/2
            for _,sign in ipairs({-1,1}) do
                wall("Entrance masonry",cx+sign*(open+chunk)/2,cy,cz-dz/2,chunk,h,0,col)
            end
            -- The old lintel used PlaceWall despite its short height;
            -- PlaceWall created a full-height obstruction across the door.
            -- Only a verified Shape lintel may be added after the door.
            deco("Doorway lintel trim",cx,lv*h+h*.9,cz-dz/2,
                open,h*.18,1.0,light)
            if lv>0 then
                deco("Upper landing balcony",cx,lv*h-.1,cz-dz/2-3,open+3,.4,5,light)
                for _,sign in ipairs({-1,1}) do
                    deco("Balustrade pillar",cx+sign*(open/2+1),lv*h+1.7,cz-dz/2-5,.55,3.4,.55,light)
                end
            else
                local marker=part("Main door position","Entrance",cx,
                    h*.46,cz-dz/2-.4,open*.86,h*.86,.45,0,light)
                if marker then
                    marker:SetAttribute("PlotStudioEntranceWidth",open)
                end
                deco("Gothic door surround",cx,lv*h+h*.83,
                    cz-dz/2-.75,open+2,.8,1.6,light)
            end
        else
            wall("South wall",cx,cy,cz-dz/2,wx,h,0,col)
        end
        if lv>0 then
            openings(cx,cz+dz/2,wx,lv,0)
            openings(cx,cz-dz/2,wx,lv,0)
        end
    end
    local function tower(x,z,r,levels,spire,entryFace)
        for level=0,levels-1 do
            local y=level*h+h/2
            local facet=r*1.16
            -- Upper turrets beyond the five buildable storeys are trim, not
            -- invalid full-height PlaceWall requests.
            local function towerFace(name,px,pz,len,rot)
                if level>=state.floors then
                    deco("High turret sculpture",px,y,pz,len,h,.65,dark,rot)
                else
                    wall(name,px,y,pz,len,h,rot,dark)
                end
            end
            for _,rot in ipairs({0,math.pi/2}) do
                for _,side in ipairs({-1,1}) do
                    local px=x+(rot==0 and 0 or side*r)
                    local pz=z+(rot==0 and side*r or 0)
                    local hasUpperDoor=level>0 and level<state.floors
                        and rot==0 and
                        ((entryFace=="N" and side==1) or
                        (entryFace=="S" and side==-1))
                    if hasUpperDoor then
                        -- Break the wall into two side pieces: a real walkable
                        -- opening (not a glass pane stuck in front of masonry).
                        local opening=math.min(7,facet*.45)
                        local remaining=(facet-opening)*.5
                        towerFace("Tower doorway west",x-(opening+remaining)*.5,pz,remaining,0)
                        towerFace("Tower doorway east",x+(opening+remaining)*.5,pz,remaining,0)
                        deco("Tower doorway lintel",x,level*h+h*.88,pz,
                            opening+1,h*.23,1.2,light)
                    else
                        towerFace("Turret face",px,pz,facet,rot)
                    end
                end
            end
            for _,sx in ipairs({-1,1}) do
                for _,sz in ipairs({-1,1}) do
                    towerFace("Octagonal corner",x+sx*r*.69,z+sz*r*.69,
                        r*.82,sx==sz and -math.pi/4 or math.pi/4)
                end
            end
            if level>0 and level<state.floors then
                deck("Floor",x,level*h-.28,z,r*2.1,r*2.1,stone)
            end
            deco("Turret cornice",x,(level+1)*h-.35,z,r*2.2,.8,r*2.2,light)
            if level>=1 then
                -- Upper turret windows use the native Windows catalog.
                -- No fake glass or decorative inserts over solid walls.
            end
        end
        local top=levels*h
        deco("Crown cornice",x,top+.15,z,r*2.3,1,r*2.3,light)
        for j=1,8 do
            local ang=j*math.pi/4
            deco("Tower battlement",x+r*math.cos(ang),top+2,z+r*math.sin(ang),
                2.4,3.1,2.4,dark)
        end
        if spire then
            for i=1,8 do
                local scale=1-i/9
                deco("Layered gothic spire",x,top+1+i*h*.29,z,
                    math.max(.9,r*2*scale),h*.31,math.max(.9,r*2*scale),
                    i%2==0 and roof or dark)
            end
            deco("Gold finial",x,top+h*3.8,z,.7,6,.7,gold)
        end
    end
    local function columns(x,z,len,axis)
        local n=math.max(3,math.floor(len/11))
        for j=0,n do
            local off=(j/n-.5)*len
            local px=x+(axis=="X" and off or 0)
            local pz=z+(axis=="Z" and off or 0)
            deco("Colonnade pillar",px,h*.45,pz,1.4,h*.88,1.4,light)
            deco("Carved capital",px,h*.9,pz,2.7,.7,2.7,gold)
        end
        deco("Colonnade beam",x,h*.97,z,axis=="X" and len+2 or 2.7,1.1,axis=="Z" and len+2 or 2.7,light)
    end

    -- Atrium cutout is left uncovered on upper decks. The staircase model is
    -- local-preview geometry until actual stair item IDs are recorded.
    -- One coordinated stairwell plan shared by floor cutouts and both flights.
    -- Floor N exits at the SOUTH edge; the mid-floor U-turn happens at the NORTH.
    local function stairwell(wx,dz)
        local wellW=math.clamp(wx*.27,17,34)
        local wellD=math.clamp(dz*.65,27,56)
        local wellX=wx*.14
        local gap=math.clamp(wellW*.10,1.3,2.4)
        local laneW=(wellW-gap-1.2)*.5
        local spread=(laneW+gap)*.5
        return wellX,wellW,wellD,laneW,spread
    end
    local function galleryWithWell(cx,cz,wx,dz,lv)
        if lv<1 then return end
        local wellX,wellW,wellD=stairwell(wx,dz)
        local west=wellX-wellW/2
        local east=wellX+wellW/2
        local leftW=west+wx/2
        local rightW=wx/2-east
        local yy=lv*h-.28
        -- Two full galleries flank the shaft, rather than covering the stairwell.
        if leftW>2 then
            deck("Gallery floor",cx-wx/2+leftW/2,yy,cz,leftW,dz-2,stone)
        end
        if rightW>2 then
            deck("Gallery floor",cx+east+rightW/2,yy,cz,rightW,dz-2,stone)
        end
        local strip=(dz-wellD)*.5
        if strip>2 then
            deck("North gallery connector",cx+wellX,yy,
                cz+wellD*.5+strip*.5,wellW,strip,stone)
            deck("South gallery exit",cx+wellX,yy,
                cz-wellD*.5-strip*.5,wellW,strip,stone)
        end
        -- Atrium railing around the opening, leaving SOUTH access for stairs.
        for _,side in ipairs({-1,1}) do
            deco("Open stairwell balustrade",cx+wellX+side*wellW*.5,
                lv*h+1.4,cz,.5,2.8,wellD,light)
        end
        deco("Northern stairwell guard",cx+wellX,lv*h+1.4,
            cz+wellD*.5,wellW,.4,.4,light)
    end
    local function grandStaircase(cx,cz,wx,dz,levels)
        if levels<2 then return end
        local wellX,wellW,wellD,laneW,spread=stairwell(wx,dz)
        local south=cz-wellD*.5+2.3
        local north=cz+wellD*.5-2.3
        local run=north-south
        local steps=math.clamp(math.floor(run/3.4+.5),7,9)
        local treadDepth=run/steps+.24
        local stairThickness=.72
        local leftLane=cx+wellX-spread
        local rightLane=cx+wellX+spread
        -- The FIRST lane climbs south -> north to the middle landing.
        -- The SECOND lane returns north -> south, reaching the next gallery.
        for lv=0,levels-2 do
            local bottom=lv*h
            local rise=h/(2*steps)
            for i=1,steps do
                local z1=south+(i-.5)*run/steps
                local top1=bottom+i*rise
                local t1=deco("Stair tread",leftLane,top1-stairThickness*.5,
                    z1,laneW,stairThickness,treadDepth,stone)
                if t1 then
                    t1:SetAttribute("PlotStudioStorey",lv)
                    t1:SetAttribute("StairFlight",1)
                end
                local z2=north-(i-.5)*run/steps
                local top2=bottom+h*.5+i*rise
                local t2=deco("Stair tread",rightLane,top2-stairThickness*.5,
                    z2,laneW,stairThickness,treadDepth,stone)
                if t2 then
                    t2:SetAttribute("PlotStudioStorey",lv)
                    t2:SetAttribute("StairFlight",2)
                end
                -- Sculpted balustrade posts outside the walking lanes.
                if i%3==1 or i==steps then
                    deco("Stair rail post",leftLane-laneW*.5-.45,
                        top1+1.15,z1,.42,2.3,.42,light)
                    deco("Stair rail post",rightLane+laneW*.5+.45,
                        top2+1.15,z2,.42,2.3,.42,light)
                end
            end
            -- A separate floor-level START landing is essential. Without it,
            -- the next storey's first flight begins across an empty cutout.
            if lv>=1 then
                local start=deco("Stair landing",leftLane,
                    bottom-stairThickness*.5,south-1.15,
                    laneW+1.65,stairThickness,6.2,stone)
                if start then
                    start:SetAttribute("PlotStudioStorey",lv)
                    start:SetAttribute("StairLandingRole","Start")
                end
            end
            -- Midway U-turn. It connects both parallel flights without
            -- overlapping either flight at a different elevation.
            local middle=deco("Stair landing",cx+wellX,bottom+h*.5-stairThickness*.5,
                north+.4,wellW-.7,stairThickness,5.2,light)
            if middle then
                middle:SetAttribute("PlotStudioStorey",lv)
                middle:SetAttribute("StairLandingRole","Turn")
            end
            -- Exit bridge reaches the SOUTH gallery at the next storey,
            -- with enough width to turn off the staircase into the room.
            local exit=deco("Stair landing",rightLane,bottom+h-stairThickness*.5,
                south-1.25,laneW+2.4,stairThickness,6.8,light)
            if exit then
                exit:SetAttribute("PlotStudioStorey",lv+1)
                exit:SetAttribute("StairLandingRole","Exit")
            end
            -- Architectural support under the halfway turn.
            deco("Stair landing support",cx+wellX,bottom+h*.23,
                north+.9,wellW*.58,h*.44,1.3,dark)
            deco("Stair level emblem",cx+wellX,bottom+h*.52,
                north+wellD*.02,2.5,1.7,.3,gold)
        end
    end

    local function lantern(x,z)
        deco("Lantern plinth",x,.45,z,2,1.1,2,dark)
        deco("Lantern pedestal",x,2.8,z,.6,4.6,.6,light)
        deco("Lantern",x,5.7,z,1.7,1.8,1.7,gold)
    end

    if state.design==1 or state.design==2 then
        -- Curved courtyard estate. The open front is for selling and events;
        -- the rear hall holds all of the actual upper floors and staircase.
        local royal=state.design==1
        local courtyardZ=-d*.16
        -- Keep the curved front FACADES inside the space between the hall
        -- and detached low wings. The prior 0.405w radius ran directly
        -- through side-wing masonry and lamp-side pavilion supports.
        local rx,rz=w*.25,d*.275
        local function curve(cx,cz,rx0,rz0,first,last,lev,col,name)
            local pieces=math.max(3,math.ceil((last-first)*math.max(rx0,rz0)/10))
            for i=1,pieces do
                local a=first+(i-1)*(last-first)/pieces
                local b=first+i*(last-first)/pieces
                local x1,z1=cx+rx0*math.cos(a),cz+rz0*math.sin(a)
                local x2,z2=cx+rx0*math.cos(b),cz+rz0*math.sin(b)
                local dx,dz=x2-x1,z2-z1
                local len=math.sqrt(dx*dx+dz*dz)
                if len>=1.8 then
                    -- A 3D wall's local X axis transforms as (cos(a),-sin(a)).
                    -- Snap shared endpoints once, not individual centers.
                    local angle=math.atan2(-dz,dx)
                    -- The server forbids overlapping wall footprints. Keep
                -- geometric endpoints shared, with no intentional overlap.
                local overlap=0
                    wall(name,(x1+x2)/2,lev*h+h/2,(z1+z2)/2,
                        len+overlap,h,angle,col)
                    deco("Curved stone coping",(x1+x2)/2,(lev+1)*h+.45,
                        (z1+z2)/2,len+overlap,.85,1.4,light,angle)
                end
            end
        end
        -- The side wings are faceted curves, not a surrounding rectangular fort.
        curve(0,courtyardZ,rx,rz,-.93,.60,0,dark,"East crescent")
        curve(0,courtyardZ,rx,rz,math.pi-.60,math.pi+.93,0,dark,"West crescent")
        -- Keep the tall rear hall, but give the unlocked plot two real
        -- two-storey side wings instead of spending the budget on a pillar.
        local kw,kd=w*.59,d*.40
        local kz=d*.245
        local wingW,wingD=w*.205,d*.35
        local wingZ=-d*.115
        for _,sign in ipairs({-1,1}) do
            currentZone="Wing"
            local wingX=sign*w*.375
            for lv=0,math.min(floors,2)-1 do
                walls(wingX,wingZ,wingW,wingD,lv,
                    royal and stone or dark,lv==0)
                if lv==1 then
                    deck("Wing upper floor",wingX,lv*h-.28,
                        wingZ,wingW-1.2,wingD-1.2,stone)
                end
            end
            nativeRoof("Side wing pitched roof",wingX,wingZ,
                wingW+1,wingD+1,math.min(floors,2)*h,"Gable")
            currentZone=nil
        end
        for lv=0,floors-1 do
            walls(0,kz,kw,kd,lv,royal and stone or dark,true)
            galleryWithWell(0,kz,kw-2,kd-2,lv)
            deco("Gallery carved frieze",0,(lv+1)*h-.36,kz,
                kw+1.2,1.15,kd+1.2,light)
            for _,sign in ipairs({-1,1}) do
                for _,f in ipairs({-.29,.29}) do
                    deco("Corinthian pilaster",sign*(kw*.5-.35),
                        lv*h+h*.49,kz+f*kd,1.2,h*.87,1.5,light)
                end
            end
        end
        grandStaircase(0,kz,kw-2,kd-2,floors)
        nativeRoof("Great hall hip roof",0,kz,
            kw+1,kd+1,floors*h,"Hip")
        -- Thin upper connections, leaving the entire central court open below.
        for lv=1,floors-1 do
            local y=lv*h-.27
            for _,sign in ipairs({-1,1}) do
                local reach=math.max(5,rx-kw*.5-4)
                deck("Side gallery connection",sign*(kw*.5+reach*.5),
                    y,kz-kd*.18,reach+5,8.5,stone)
                deco("Curved balcony railing",sign*(kw*.5+reach*.5),
                    lv*h+1.25,kz-kd*.18-4.8,reach+4,.7,2.5,light)
            end
        end
        local frontZ=kz-kd*.5
        local entry=math.min(18,kw*.25)
        for i=-4,4 do
            local t=i/5
            deco("Rounded entrance cornice",i*entry*.28,h*.95,
                frontZ-2-math.sqrt(math.max(0,1-t*t))*2.3,
                entry*.31,1.2,1.2,light)
        end
        for _,sign in ipairs({-1,1}) do
            local x=sign*(entry*.72)
            deco("Column plinth",x,.65,frontZ-3,3.2,1.3,3.2,light)
            deco("Corinthian column",x,h*.43,frontZ-3,1.7,h*.82,1.7,light)
            deco("Gilded column capital",x,h*.88,frontZ-3,3.4,1.15,3.4,gold)
        end
        local promenadeZ=-d*.30
        for i=1,9 do
            local angle=math.pi*.14+(i-.5)/9*math.pi*.72
            local x=math.cos(angle)*w*.27
            local z=promenadeZ+math.sin(angle)*d*.075
            deco("Open court paving",x,.18,z,math.max(4,w*.061),.36,6.5,
                i%2==0 and stone or light,angle-math.pi*.5)
        end
        -- No freestanding pavilion / 'stand' beside lanterns:
        -- those Shapes intruded into the curved front wall footprint.
        -- Keep small lanterns toward the front corners, independently
        -- of the low crescent masonry and the side-wing walls.
        for _,sign in ipairs({-1,1}) do
            lantern(sign*w*.34,-d*.385)
        end
        deco("Sweeping palace pediment",0,floors*h+.85,kz,
            kw*.46,2.2,kd*.22,roof)
        for _,sign in ipairs({-1,1}) do
            deco("Gilded roof finial",sign*kw*.27,floors*h+3.1,
                kz,1.15,5.6,1.15,gold)
        end
        if royal then
            for i=-2,2 do
                deco("Royal balcony crest",i*kw*.14,(floors-1)*h+h*.9,
                    frontZ-1,2.8,2.6,1.1,gold)
            end
        else
            for _,sign in ipairs({-1,1}) do
                deco("Rear basalt buttress",sign*kw*.48,h*1.1,
                    kz+kd*.47,3.8,h*2.2,3.8,dark)
            end
        end
    elseif state.design==3 then
        -- Palace: two huge wings and a central cour d'honneur with marble arcade.
        local wingW,wingD=w*.27,d*.68
        local pos=w*.34
        for _,sx in ipairs({-1,1}) do
            local x=sx*pos
            for lv=0,floors-1 do
                walls(x,d*.06,wingW,wingD,lv,light,lv==0)
                galleryWithWell(x,d*.06,wingW,wingD,lv)
            end
            nativeRoof("Palace wing roof",x,d*.06,wingW+1,wingD+1,floors*h,"Hip")
            grandStaircase(x,d*.06,wingW,wingD,floors)
            columns(x,-d*.31,wingW,"X")
            for _,z in ipairs({-d*.21,d*.27}) do tower(x,z,math.min(wingW*.23,10),floors+1,true) end
        end
        for lv=0,floors-1 do
            walls(0,d*.3,w*.43,d*.22,lv,stone,lv==0)
            if lv>0 then deck("Gallery floor",0,lv*h-.3,d*.3,w*.43,d*.22,light) end
        end
        nativeRoof("Palace central roof",0,d*.3,w*.43+1,d*.22+1,
            floors*h,"Gable")
        tower(0,d*.3,math.min(w*.085,12),floors+2,true)
        columns(0,-d*.43,w*.49,"X")
        deco("Formal central garden",0,.08,-d*.18,w*.25,.18,d*.3,Color3.fromRGB(75,128,89))
        for _,x in ipairs({-w*.13,w*.13}) do lantern(x,-d*.34) end
    elseif state.design==4 then
        -- Showroom: long glazed gallery, floating illuminated roof ribs, atrium.
        local wx,dz=w*.77,d*.84
        for lv=0,floors-1 do
            walls(0,0,wx,dz,lv,dark,lv==0)
            galleryWithWell(0,0,wx,dz,lv)
            openings(0,dz/2,wx,math.max(1,lv),0)
        end
        grandStaircase(0,0,wx,dz,floors)
        for i=-6,6 do
            local x=i*wx/13
            deco("Facade mullion",x,floors*h/2,-dz/2-1,1,floors*h,1,light)
            glaze(x,floors*h/2,-dz/2-1,wx/15,floors*h,0)
        end
        nativeRoof("Showroom roof",0,0,wx+2,dz+2,floors*h,"Hip")
        for _,z in ipairs({-dz*.32,-dz*.11,dz*.11,dz*.32}) do
            deco("Atrium gilded roof rib",0,floors*h+1.1,z,wx+4,2,1.3,gold)
        end
        columns(0,-dz*.48,wx*.91,"X")
    else
        -- Tower outpost: monolithic citadel plus tall spired central observatory.
        local size=math.min(w,d)*.51
        for lv=0,floors-1 do
            walls(0,0,size,size,lv,dark,lv==0)
            galleryWithWell(0,0,size,size,lv)
        end
        grandStaircase(0,0,size,size,floors)
        nativeRoof("Watchtower roof",0,0,size+2,size+2,floors*h,"Pyramid")
        tower(0,0,math.min(size*.24,13),floors+4,true)
        for _,x in ipairs({-w*.36,w*.36}) do
            tower(x,d*.27,math.min(w*.073,9),floors+1,false)
            deco("Suspended skybridge",x*.5,h*.9,d*.15,math.abs(x),1.2,6,light)
        end
        crenels(0,-size/2,size,floors*h+1,0)
    end
    notify("DESIGN PREVIEW: "..count.." pieces / "..profile.name..
        " / two-flight switchback stairs + middle and upper landings")
    if state.page=="Builder" and switchPage then switchPage("Builder") end
end

-- Build engine v0.3. The first real action is always a one-wall test.
local build={busy=false,cancel=false,passed=false,signature=nil,firstIndex=nil,status="Not started",sent=0,total=0,lastAudit="No construction audit yet"}
-- Timing presets apply only to actual construction requests.
-- Delays are intentionally bounded to avoid an unbounded remote spam loop.
local BUILD_SPEEDS={
    Steady={interval=.24,burst=10,cooldown=.17},
    Fast={interval=.15,burst=12,cooldown=.20},
    Turbo={interval=.10,burst=9,cooldown=.24},
}
local buildStatusText=nil
local function refreshBuildStatus()
    if buildStatusText and buildStatusText.Parent then
        buildStatusText.Text=build.status
    end
end
local function buildSignature(plot,origin)
    return plot.Name.."|"..tostring(state.design).."|"..tostring(state.floors).."|"..tostring(origin.Position)
end

-- Respect occupied structures. A wall can only collide with a wall on its
-- own storey when both run along nearly the same line; intersecting corners
-- are allowed. Removed intervals are NOT sent again.
local function overlapLength(u,v)
    if u.lv~=v.lv then return nil end
    local axis=u.b-u.a
    local dir=Vector3.new(axis.X,0,axis.Z)
    local l=dir.Magnitude
    if l<1 then return nil end
    dir=dir/l
    local diff=v.b-v.a
    local dir2=Vector3.new(diff.X,0,diff.Z)
    if dir2.Magnitude<1 or math.abs(dir:Dot(dir2.Unit))<.992 then return nil end
    local pa,pb=v.a-u.a,v.b-u.a
    if math.max(math.abs(pa.X*dir.Z-pa.Z*dir.X),
        math.abs(pb.X*dir.Z-pb.Z*dir.X))>1.1 then return nil end
    local t1=pa.X*dir.X+pa.Z*dir.Z
    local t2=pb.X*dir.X+pb.Z*dir.Z
    local lo,hi=math.max(0,math.min(t1,t2)),math.min(l,math.max(t1,t2))
    -- Only treat a substantial collinear run as a duplicate. Adjacent
    -- curved segments meet at a CORNER and must not erase one another.
    if hi-lo<1.35 then return nil end
    return math.max(0,lo-.08),math.min(l,hi+.08)
end
local function openWallSegments(unit,occupied)
    local len=Vector3.new(unit.b.X-unit.a.X,0,unit.b.Z-unit.a.Z).Magnitude
    if len<1.8 then return {} end
    local ranges={{0,len}}
    for _,other in ipairs(occupied) do
        if other.kind=="Wall" then
            local lo,hi=overlapLength(unit,other)
            if lo then
                local nextRanges={}
                for _,range in ipairs(ranges) do
                    if lo>=range[2] or hi<=range[1] then
                        nextRanges[#nextRanges+1]=range
                    else
                        if lo-range[1]>=1.8 then nextRanges[#nextRanges+1]={range[1],lo} end
                        if range[2]-hi>=1.8 then nextRanges[#nextRanges+1]={hi,range[2]} end
                    end
                end
                ranges=nextRanges
                if #ranges==0 then break end
            end
        end
    end
    local result={}
    for _,range in ipairs(ranges) do
        -- Tiny slivers are artifacts of collision clipping. Sending them
        -- produces server "wall already there" errors and ugly seams.
        if range[2]-range[1]>=2.25 then
        result[#result+1]={kind="Wall",lv=unit.lv,
            a=unit.a:Lerp(unit.b,range[1]/len),
            b=unit.a:Lerp(unit.b,range[2]/len),
            color=unit.color,material=unit.material}
        end
    end
    return result
end
local function surfaceOverlaps(a,b)
    if a.kind~=b.kind or a.lv~=b.lv or not a.cf or not b.cf then return false end
    if math.abs(a.cf.Position.Y-b.cf.Position.Y)>1.8 then return false end
    local delta=b.cf.Position-a.cf.Position
    for _,axis in ipairs({a.cf.RightVector,a.cf.LookVector,b.cf.RightVector,b.cf.LookVector}) do
        local ra=a.sx/2*math.abs(a.cf.RightVector:Dot(axis))+
            a.sz/2*math.abs(a.cf.LookVector:Dot(axis))
        local rb=b.sx/2*math.abs(b.cf.RightVector:Dot(axis))+
            b.sz/2*math.abs(b.cf.LookVector:Dot(axis))
        if math.abs(delta:Dot(axis))>=ra+rb-.4 then return false end
    end
    return true
end
local function occupiedFromPlot(plot,origin)
    local result={}
    local h=15
    pcall(function()
        local cfg=require(game:GetService("ReplicatedStorage").Modules.PlotConfig)
        if type(cfg.StoreyHeight)=="number" then h=cfg.StoreyHeight end
    end)
    h=math.clamp(h,6,30)
    local seen={}
    for _,name in ipairs({"Structures","Floors","Roofs","Furniture"}) do
        local folder=plot:FindFirstChild(name)
        if folder then
            for _,m in ipairs(folder:GetDescendants()) do
                local isSoloPart=m:IsA("BasePart") and
                    not (m:FindFirstAncestorOfClass("Model") and
                        m:FindFirstAncestorOfClass("Model"):IsDescendantOf(folder))
                if (m:IsA("Model") or isSoloPart) and not seen[m] then
                    seen[m]=true
                    local cf,len=m:GetAttribute("WallCFrame"),m:GetAttribute("WallLength")
                    local level=m:GetAttribute("Storey")
                    if typeof(cf)=="CFrame" and type(len)=="number" and len>1 then
                        local lv=type(level)=="number" and level or
                            math.floor((cf.Position.Y-origin.Position.Y)/h)
                        result[#result+1]={kind="Wall",
                            a=cf.Position-cf.RightVector*(len/2),
                            b=cf.Position+cf.RightVector*(len/2),
                            lv=math.clamp(math.floor(lv),0,4)}
                    else
                        local category=tostring(m:GetAttribute("Category") or
                            m:GetAttribute("ItemCategory") or "")
                        local id=tostring(m:GetAttribute("ItemId") or "")
                        local nameLower=m.Name:lower()
                        local kind
                        if category=="Floors" or id=="32" or
                            nameLower:find("floor",1,true) then kind="Floor"
                        elseif category=="Roofs" or m:GetAttribute("RoofStyle")~=nil
                            or nameLower:find("roof",1,true) then kind="Roof" end
                        if kind then
                            local ok,box,size=pcall(function()
                                if m:IsA("BasePart") then return m.CFrame,m.Size end
                                return m:GetBoundingBox()
                            end)
                            if ok and size.X>=1 and size.Z>=1 and size.X<300 and size.Z<300 then
                                local lv=type(level)=="number" and level or
                                    math.floor((box.Position.Y-origin.Position.Y)/h+.15)
                                result[#result+1]={kind=kind,cf=box,
                                    sx=size.X,sz=size.Z,lv=math.clamp(math.floor(lv),0,4)}
                            end
                        end
                    end
                end
            end
        end
    end
    return result
end
local function filterBuildUnits(units,plot,origin,extra)
    local occupied=occupiedFromPlot(plot,origin)
    if extra then occupied[#occupied+1]=extra end
    local result,skipped,trimmed={},0,0
    for _,unit in ipairs(units) do
        if unit.kind=="Wall" then
            local segments=openWallSegments(unit,occupied)
            if #segments==0 then skipped=skipped+1
            else
                if #segments~=1 or (segments[1].b-segments[1].a).Magnitude<
                    (unit.b-unit.a).Magnitude-.3 then trimmed=trimmed+1 end
                for _,seg in ipairs(segments) do
                    result[#result+1]=seg
                    occupied[#occupied+1]=seg
                end
            end
        else
            local blocked=false
            for _,other in ipairs(occupied) do
                if surfaceOverlaps(unit,other) then blocked=true;break end
            end
            if blocked then skipped=skipped+1
            else result[#result+1]=unit;occupied[#occupied+1]=unit end
        end
    end
    return result,{skipped=skipped,trimmed=trimmed}
end


-- Discover the live furniture catalog rather than guessing five stair IDs.
-- Scans real furniture definitions. Hard-coded item "5" is no longer assumed
-- to be a stone wall: the game may use it for a different wall style.
-- The game keeps plot-build furniture separate from auction inventory.
-- This scanner reads ONLY ReplicatedStorage.Modules.Furniture. It does not
-- inspect players' inventories, auction items, or their stock collections.
local BUILD_CATEGORIES={
    "Walls","Doors","Windows","Floors","Ceilings","Structural",
    "Shelves","Tables","Chairs","Kitchen","Lights","Outdoor","Shapes"
}
local BUILD_CATEGORY_SET={}
for _,name in ipairs(BUILD_CATEGORIES) do BUILD_CATEGORY_SET[name]=true end
local BUILD_ROOF_STYLES={
    "Flat","Gable","Hip","Shed","Parapet","Gambrel","Saltbox",
    "Butterfly","Pyramid","Pagoda","Sawtooth","Barrel"
}
local excludedCatalogCategories={
    Stock=true,Inventory=true,Items=true,Auction=true,Loot=true,Storage=true
}
local stairCatalog={
    scanned=false,scanning=false,models={},shape=nil,wall=nil,walls={},error=nil
}
local buildCatalog={
    entries={},byCategory={},byId={},scanned=false,scanning=false,
    skipped=0,total=0,sources={},status="Waiting for initial scan",
    filter="All",query="",scanNumber=0
}
local nativeWindow={
    id=nil,name=nil,passed=false,signature=nil,
    status="Scan the catalog to identify real structural windows"
}
local nativeDoor={
    id=nil,name=nil,passed=false,signature=nil,
    status="Scan the catalog to identify native entrance doors"
}
local stairStatus="Build catalog has not been scanned"
local function scoreWall(name)
    local lower=name:lower()
    if lower:find("glass",1,true) or lower:find("clear",1,true)
        or lower:find("window",1,true) or lower:find("transparent",1,true) then
        return -999
    end
    local score=0
    for _,rule in ipairs({
        {"stone",140},{"brick",110},{"solid",105},{"plaster",90},
        {"plain",80},{"wood",65},{"wall",35},{"medieval",60},
    }) do
        if lower:find(rule[1],1,true) then score=score+rule[2] end
    end
    return score
end
local function scanStairs()
    if stairCatalog.scanning then return false end
    stairCatalog.scanning=true
    buildCatalog.scanning=true
    buildCatalog.status="Scanning build catalog..."
    stairStatus="Scanning build catalog..."
    local ok,registry=pcall(function()
        return require(game:GetService("ReplicatedStorage").Modules.Furniture)
    end)
    if not ok or type(registry)~="table" then
        stairCatalog.scanned=false
        stairCatalog.scanning=false
        buildCatalog.scanning=false
        stairCatalog.error="Replicated Furniture catalog unavailable"
        buildCatalog.status=stairCatalog.error
        stairStatus=stairCatalog.error
        notify(stairStatus)
        return false
    end
    local entries,byId,byCategory={}, {}, {}
    local discoveredSources={}
    local skipped=0
    local function register(raw,fallback,source,categoryHint)
        if type(raw)~="table" then return end
        local category=raw.Category or raw.BuildCategory or categoryHint
        local name=raw.Name or raw.DisplayName or raw.Label or raw.Title
        local id=raw.Id or raw.ID or raw.ItemId or raw.ItemID or raw.id or fallback
        if type(category)~="string" or excludedCatalogCategories[category]
            or not BUILD_CATEGORY_SET[category] then
            return
        end
        if raw.IsStockItem==true or raw.IsInventoryItem==true
            or raw.InventoryOnly==true or raw.IsAuctionItem==true then
            return
        end
        if type(name)~="string" or name=="" or
            (type(id)~="string" and type(id)~="number") then
            skipped=skipped+1
            return
        end
        id=tostring(id)
        if id=="" then skipped=skipped+1;return end
        local key=category.."|"..id
        if byId[key] then return end
        local row={id=id,name=name,category=category,source=source or "Furniture"}
        entries[#entries+1]=row
        byId[key]=row
        byCategory[category]=byCategory[category] or {}
        table.insert(byCategory[category],row)
        discoveredSources[source or "Furniture"]=true
    end
    local traversed={}
    local traversedCount=0
    local function walk(data,depth,hint,source,fallback)
        if type(data)~="table" or traversed[data] or depth>4
            or traversedCount>20000 then return end
        traversed[data]=true
        traversedCount=traversedCount+1
        if type(data.Name or data.DisplayName or data.Label or data.Title)=="string"
            and type(data.Category or data.BuildCategory or hint)=="string" then
            local itemId=data.Id or data.ID or data.ItemId or data.ItemID
                or data.id or fallback
            if type(itemId)=="number" or type(itemId)=="string" then
                register(data,fallback,source,hint)
                return
            end
            -- Some catalogs have named category containers; descend to their
            -- actual item definitions instead of missing the entire folder.
        end
        for key,value in pairs(data) do
            if type(value)=="table" then
                local nextHint=hint
                if type(key)=="string" and BUILD_CATEGORY_SET[key] then
                    nextHint=key
                end
                local nextFallback=nil
                if type(key)=="number" or
                    (type(key)=="string" and key:match("^%d+$")) then
                    nextFallback=key
                end
                walk(value,depth+1,nextHint,source,nextFallback)
            end
        end
    end
    -- Prefer complete exported collections if a game update supplies them.
    for _,method in ipairs({
        "GetAll","GetAllItems","GetAllFurniture","GetCatalog",
        "GetItems","GetFurniture","ListAll","GetItemList"
    }) do
        local fn=registry[method]
        if type(fn)=="function" then
            local got,result=pcall(fn,registry)
            if got and type(result)=="table" then
                walk(result,0,nil,method,nil)
            end
        end
    end
    for _,category in ipairs(BUILD_CATEGORIES) do
        -- Category APIs sometimes expose non-numeric or non-contiguous IDs.
        for _,method in ipairs({
            "GetByCategory","GetAllByCategory","GetCategoryItems",
            "GetItemsByCategory","GetCategory"
        }) do
            local fn=registry[method]
            if type(fn)=="function" then
                local got,result=pcall(fn,registry,category)
                if got and type(result)=="table" then
                    walk(result,0,category,method,nil)
                end
            end
        end
        if type(registry[category])=="table" then
            walk(registry[category],0,category,"Furniture."..category,nil)
        end
    end
    for _,key in ipairs({
        "All","AllItems","Items","Data","Definitions","Catalog","ById",
        "ItemsById","Furniture","FurnitureItems","ItemList","Entries","List"
    }) do
        if type(registry[key])=="table" then
            walk(registry[key],0,nil,"Furniture."..key,nil)
        end
    end
    -- Fallback for the GetById interface exposed by BuildState.
    -- Bounded scan; nonnumeric IDs can still be found by exports above.
    if type(registry.GetById)=="function" then
        for i=1,4500 do
            if not alive then break end
            local resultOK,data=pcall(registry.GetById,registry,tostring(i))
            if resultOK then register(data,i,"GetById",nil) end
            if i%175==0 then
                buildCatalog.status="Scanning item IDs... "..i.."/4500"
                task.wait()
            end
        end
    end
    for _,rows in pairs(byCategory) do
        table.sort(rows,function(a,b)
            if a.name~=b.name then return a.name:lower()<b.name:lower() end
            return a.id<b.id
        end)
    end
    table.sort(entries,function(a,b)
        if a.category~=b.category then return a.category<b.category end
        if a.name~=b.name then return a.name:lower()<b.name:lower() end
        return a.id<b.id
    end)
    local stairs,shapes,walls={},{},{}
    local windows,doors={},{} 
    for _,entry in ipairs(entries) do
        local low=entry.name:lower()
        if low:find("stair",1,true) or low:find("steps",1,true) then
            if entry.category=="Structural" or entry.category=="Shapes"
                or entry.category=="Outdoor" then
                stairs[#stairs+1]=entry
            end
        end
        if entry.category=="Shapes" and
            (low:find("block",1,true) or low:find("cube",1,true)
                or low:find("box",1,true)) then
            shapes[#shapes+1]=entry
        end
        if entry.category=="Windows" then
            windows[#windows+1]=entry
        elseif entry.category=="Doors" then
            doors[#doors+1]=entry
        end
        if entry.category=="Walls" then
            local wall={
                id=entry.id,name=entry.name,category=entry.category,
                score=scoreWall(entry.name)
            }
            walls[#walls+1]=wall
        end
    end
    table.sort(stairs,function(a,b)return a.name:lower()<b.name:lower() end)
    table.sort(doors,function(a,b)
        local function score(v)
            local n=v.name:lower()
            return (n:find("castle",1,true) and 50 or 0)
                +(n:find("gothic",1,true) and 40 or 0)
                +(n:find("double",1,true) and 25 or 0)
                +(n:find("arched",1,true) and 20 or 0)
                +(n:find("door",1,true) and 10 or 0)
        end
        if score(a)~=score(b) then return score(a)>score(b) end
        return a.name:lower()<b.name:lower()
    end)
    table.sort(windows,function(a,b)
        local function score(v)
            local n=v.name:lower()
            return (n:find("gothic",1,true) and 50 or 0)
                +(n:find("arched",1,true) and 40 or 0)
                +(n:find("stone",1,true) and 20 or 0)
                +(n:find("window",1,true) and 10 or 0)
        end
        if score(a)~=score(b) then return score(a)>score(b) end
        return a.name:lower()<b.name:lower()
    end)
    table.sort(shapes,function(a,b)
        local function score(row)
            local n=row.name:lower()
            return (n:find("cube",1,true) and 20 or 0)
                +(n:find("block",1,true) and 10 or 0)
        end
        if score(a)~=score(b) then return score(a)>score(b) end
        return a.name:lower()<b.name:lower()
    end)
    table.sort(walls,function(a,b)
        if a.score~=b.score then return a.score>b.score end
        return a.name:lower()<b.name:lower()
    end)
    -- Preserve a selected wall/shape when still present after a rescan.
    local previousWall=stairCatalog.wall and stairCatalog.wall.id
    local previousShape=stairCatalog.shape and stairCatalog.shape.id
    stairCatalog.wall=nil
    for _,entry in ipairs(walls) do
        if entry.id==previousWall and entry.score>=0 then
            stairCatalog.wall=entry;break
        end
    end
    if not stairCatalog.wall and walls[1] and walls[1].score>=0 then
        stairCatalog.wall=walls[1]
    end
    stairCatalog.shape=nil
    for _,entry in ipairs(shapes) do
        if entry.id==previousShape then stairCatalog.shape=entry;break end
    end
    stairCatalog.shape=stairCatalog.shape or shapes[1]
    stairCatalog.models=stairs
    stairCatalog.walls=walls
    local oldDoor=nativeDoor.id
    local doorChoice
    for _,entry in ipairs(doors) do
        if entry.id==oldDoor then doorChoice=entry;break end
    end
    doorChoice=doorChoice or doors[1]
    if (doorChoice and doorChoice.id or nil)~=oldDoor then
        nativeDoor.passed=false
        nativeDoor.signature=nil
    end
    nativeDoor.id=doorChoice and doorChoice.id or nil
    nativeDoor.name=doorChoice and doorChoice.name or nil
    nativeDoor.status=doorChoice and
        ("Native doors: "..#doors.." / "..doorChoice.name..
        " / test one entrance") or "No native Doors found in catalog"
    local priorWindow=nativeWindow.id
    local chosenWindow
    for _,entry in ipairs(windows) do
        if entry.id==priorWindow then chosenWindow=entry;break end
    end
    chosenWindow=chosenWindow or windows[1]
    if (chosenWindow and chosenWindow.id or nil)~=priorWindow then
        nativeWindow.passed=false
        nativeWindow.signature=nil
    end
    nativeWindow.id=chosenWindow and chosenWindow.id or nil
    nativeWindow.name=chosenWindow and chosenWindow.name or nil
    nativeWindow.status=chosenWindow and
        ("Native Windows: "..#windows.." styles / selected "..chosenWindow.name..
        " / single-window test required") or "No native Windows found in catalog"
    stairCatalog.scanned=true
    stairCatalog.scanning=false
    stairCatalog.error=nil
    buildCatalog.entries=entries
    buildCatalog.byCategory=byCategory
    buildCatalog.byId=byId
    buildCatalog.scanned=true
    buildCatalog.scanning=false
    buildCatalog.total=#entries
    buildCatalog.skipped=skipped
    buildCatalog.sources=discoveredSources
    buildCatalog.scanNumber=buildCatalog.scanNumber+1
    buildCatalog.status="Found "..#entries.." building items in "..
        tostring(#BUILD_CATEGORIES).." eligible categories"
    stairStatus=#stairs.." stair models | "..#shapes..
        " shapes | "..#walls.." walls | "..#windows.." windows | "..#doors.." doors"
    notify("Build Catalog: "..#entries.." build items / stock & inventory excluded")
    return true
end
local function ensureCatalog()
    if stairCatalog.scanned then return true end
    if stairCatalog.scanning then
        notify("Build catalog scan is still running")
        return false
    end
    return scanStairs()
end
local function isGlassModel(model)
    local seen,glass=0,0
    for _,part in ipairs(model:GetDescendants()) do
        if part:IsA("BasePart") and part.Size.Magnitude>2 then
            seen=seen+1
            if part.Material==Enum.Material.Glass
                or part.Transparency>=.55 then glass=glass+1 end
        end
    end
    return seen>0 and glass/seen>=.65
end
local function buildPlan()
    if not previewFolder then beginPreview() end
    if not previewFolder then return nil end
    local plot=ownedPlot()
    if not plot then return nil end
    local origin=plotFrame(plot)
    if not origin then return nil end
    local config
    pcall(function() config=require(game:GetService("ReplicatedStorage").Modules.PlotConfig) end)
    local h=config and config.StoreyHeight or 15
    if type(h)~="number" or h<6 or h>30 then h=15 end
    local units={}
    for _,p in ipairs(previewFolder:GetChildren()) do
        if p:IsA("BasePart") and p:GetAttribute("PlotStudioKind") then
            local kind=p:GetAttribute("PlotStudioKind")
            if kind=="Floor" then
                local lv=math.clamp(math.floor((p.Position.Y-origin.Position.Y+.55)/h+.1),0,4)
                local nx,nz=math.ceil(p.Size.X/40),math.ceil(p.Size.Z/40)
                for ix=1,nx do for iz=1,nz do
                    local sx,sz=p.Size.X/nx,p.Size.Z/nz
                    local cf=p.CFrame*CFrame.new((ix-.5)*sx-p.Size.X/2,0,(iz-.5)*sz-p.Size.Z/2)
                    units[#units+1]={kind="Floor",cf=cf,sx=sx,sz=sz,lv=lv,
                        zone=p:GetAttribute("PlotStudioZone"),
                        color=p:GetAttribute("PlotStudioColor"),
                        material=p:GetAttribute("PlotStudioMaterial")}
                end end
            elseif kind=="Roof" then
                local lv=math.clamp(math.floor((p.Position.Y-origin.Position.Y+.4)/h+.1)-1,0,4)
                local cf=origin:ToObjectSpace(p.CFrame)
                units[#units+1]={kind="Roof",x=cf.Position.X,z=cf.Position.Z,
                    sx=p.Size.X,sz=p.Size.Z,lv=lv,
                    style=p:GetAttribute("PlotStudioRoofStyle") or "Hip",
                    zone=p:GetAttribute("PlotStudioZone"),
                    color=p:GetAttribute("PlotStudioColor"),
                    material=p:GetAttribute("PlotStudioMaterial")}
            elseif kind=="Wall" then
                local lv=math.clamp(math.floor((p.Position.Y-origin.Position.Y)/h),0,4)
                local count=math.ceil(p.Size.X/15)
                for k=1,count do
                    local x1=-p.Size.X/2+(k-1)*p.Size.X/count
                    local x2=-p.Size.X/2+k*p.Size.X/count
                    local a=p.CFrame:PointToWorldSpace(Vector3.new(x1,-p.Size.Y/2,0))
                    local b=p.CFrame:PointToWorldSpace(Vector3.new(x2,-p.Size.Y/2,0))
                    units[#units+1]={kind="Wall",a=a,b=b,lv=lv,
                        zone=p:GetAttribute("PlotStudioZone"),
                        material=p:GetAttribute("PlotStudioMaterial"),
                        color=p:GetAttribute("PlotStudioColor")}
                end
            end
        end
    end
    local priority={Floor=1,Wall=2,Roof=3}
    table.sort(units,function(x,y)
        if x.lv~=y.lv then return x.lv<y.lv end
        return priority[x.kind]<priority[y.kind]
    end)
    local extra=build.passed and build.testUnit and
        build.signature==buildSignature(plot,origin) and build.testUnit or nil
    local accepted,stats=filterBuildUnits(units,plot,origin,extra)
    return accepted,plot,origin,stats
end
local function eventFor(kind)
    local folder=game:GetService("ReplicatedStorage"):FindFirstChild("Events")
    folder=folder and folder:FindFirstChild("Plot")
    local event=folder and folder:FindFirstChild("Place"..kind)
    if event and event:IsA("RemoteEvent") then return event end
end

-- Convert each ornate preview tread to a candidate PlaceItem Shapes request.
-- This remains gated until a single shape has been accepted by the server.
local stairTest={passed=false,signature=nil,first=nil,itemId=nil}
local function rawStairUnits(plot,origin)
    local result={}
    if not previewFolder then beginPreview() end
    if not previewFolder then return result end
    if not stairCatalog.scanned or not stairCatalog.shape then return result end
    local h=15
    pcall(function()
        local cfg=require(game:GetService("ReplicatedStorage").Modules.PlotConfig)
        if type(cfg.StoreyHeight)=="number" then h=cfg.StoreyHeight end
    end)
    h=math.clamp(h,6,30)
    for _,p in ipairs(previewFolder:GetChildren()) do
        if p:IsA("BasePart") and (p.Name=="Stair tread" or p.Name=="Stair landing") then
            result[#result+1]={
                kind="StairShape",
                id=stairCatalog.shape.id,
                label=p.Name,
                role=p:GetAttribute("StairLandingRole"),
                cf=p.CFrame,
                size=p.Size,
                color=p:GetAttribute("PlotStudioColor"),
                material=p:GetAttribute("PlotStudioMaterial"),
                lv=math.clamp(p:GetAttribute("PlotStudioStorey") or
                    math.floor((p.Position.Y-origin.Position.Y)/h),0,4)
            }
        end
    end
    table.sort(result,function(a,b)
        if a.lv~=b.lv then return a.lv<b.lv end
        if a.cf.Position.Y~=b.cf.Position.Y then
            return a.cf.Position.Y<b.cf.Position.Y
        end
        return a.cf.Position.Z<b.cf.Position.Z
    end)
    return result
end
local function sameStairUnit(a,b)
    return a and b and a.id==b.id and (a.cf.Position-b.cf.Position).Magnitude<.45
end
-- The game may store Shapes under Furniture, Structures or a Shapes
-- folder and sometimes marks the category without an ItemId on the
-- outer model. Scan plausible roots, never arbitrary loose plot parts.
local function shapeModels(plot)
    local result={}
    local seen={}
    for _,name in ipairs({"Furniture","Structures","Shapes","Decorations"}) do
        local folder=plot:FindFirstChild(name)
        if folder then
            for _,model in ipairs(folder:GetDescendants()) do
                if (model:IsA("Model") or model:IsA("BasePart")) and
                    not seen[model] then
                    local itemId=model:GetAttribute("ItemId")
                    local cat=model:GetAttribute("Category") or
                        model:GetAttribute("ItemCategory")
                    if itemId~=nil or cat=="Shapes" then
                        seen[model]=true
                        result[#result+1]=model
                    end
                end
            end
        end
    end
    return result
end
local function shapeIdentityMatches(model,request)
    local id=model:GetAttribute("ItemId")
    if id~=nil then return tostring(id)==tostring(request.id) end
    local cat=model:GetAttribute("Category") or
        model:GetAttribute("ItemCategory")
    return cat=="Shapes"
end
local function shapeBounds(model)
    if model:IsA("BasePart") then
        return model.CFrame,model.Size
    end
    local ok,cf,size=pcall(function() return model:GetBoundingBox() end)
    if ok then return cf,size end
    return nil,nil
end
local function shapeIsVisibleAndSolid(model,needsWalkable)
    local parts={}
    if model:IsA("BasePart") then parts={model}
    else parts=model:GetDescendants() end
    local visible,solid=false,false
    for _,piece in ipairs(parts) do
        if piece:IsA("BasePart") and piece.Transparency<.88 then
            visible=true
            if piece.CanCollide and piece.CFrame.UpVector.Y>.7 then
                solid=true
            end
        end
    end
    return visible and (not needsWalkable or solid)
end
local function shapeSizeFits(size,wanted,loose)
    if not size or not wanted then return false end
    local ratio=loose and .4 or .27
    return math.abs(size.X-wanted.X)<math.max(loose and 2 or .85,wanted.X*ratio)
        and math.abs(size.Y-wanted.Y)<math.max(loose and 1 or .55,wanted.Y*(loose and .75 or .42))
        and math.abs(size.Z-wanted.Z)<math.max(loose and 2 or .85,wanted.Z*ratio)
end
local function verifyPlacedStair(plot,request,before)
    for _,model in ipairs(shapeModels(plot)) do
        if not before[model] and shapeIdentityMatches(model,request) then
            local cf,size=shapeBounds(model)
            if cf and (cf.Position-request.cf.Position).Magnitude<3.2 and
                shapeSizeFits(size,request.size,true) and
                shapeIsVisibleAndSolid(model,request.kind=="StairShape") then
                return true
            end
        end
    end
    return false
end
local function stairsAlreadyPresent(plot,u)
    for _,model in ipairs(shapeModels(plot)) do
        if shapeIdentityMatches(model,u) then
            local cf,size=shapeBounds(model)
            if cf and (cf.Position-u.cf.Position).Magnitude<1.45 and
                shapeSizeFits(size,u.size,false) and
                shapeIsVisibleAndSolid(model,u.kind=="StairShape") then
                return true
            end
        end
    end
    return false
end

-- Non-destructive access/design audit. This checks preview geometry, not
-- whether the server accepted actual PlaceItem/PlaceFloor requests.
local function previewAccessAudit()
    if not previewFolder then beginPreview() end
    if not previewFolder then notify("Unable to construct the preview");return end
    local counts={wall=0,floor=0,roof=0,detail=0,glass=0,stairs=0,landings=0,bridges=0}
    local flights,turns,exits={},{},{}
    local materialSet={}
    for _,p in ipairs(previewFolder:GetChildren()) do
        if p:IsA("BasePart") then
            local kind=p:GetAttribute("PlotStudioKind")
            local mat=p:GetAttribute("PlotStudioMaterial")
            if mat then materialSet[mat]=true end
            if kind=="Wall" then counts.wall=counts.wall+1 end
            if kind=="Floor" then counts.floor=counts.floor+1 end
            if kind=="Roof" then counts.roof=counts.roof+1 end
            if kind=="Decor" then counts.detail=counts.detail+1 end
            if kind=="Glass" then counts.glass=counts.glass+1 end
            if p.Name=="Stair tread" then
                counts.stairs=counts.stairs+1
                local level=p:GetAttribute("PlotStudioStorey")
                local flight=p:GetAttribute("StairFlight")
                if type(level)=="number" then
                    flights[level]=flights[level] or {[1]=0,[2]=0}
                    if flight==1 or flight==2 then
                        flights[level][flight]=flights[level][flight]+1
                    end
                end
            end
            if p.Name=="Stair landing" then
                counts.landings=counts.landings+1
                local level=p:GetAttribute("PlotStudioStorey")
                if type(level)=="number" then
                    if p.Position.Y>0 then
                        turns[level]=(turns[level] or 0)+1
                    end
                end
            end
            if p.Name:find("skybridge",1,true) or
                p.Name:find("connecting gallery",1,true) or
                p.Name:find("Rampart skywalk",1,true) then
                counts.bridges=counts.bridges+1
            end
        end
    end
    local floors=math.min(state.floors,(designs[state.design] or designs[1]).floors)
    local missing={}
    for lv=0,floors-2 do
        if not flights[lv] or flights[lv][1]<8 or flights[lv][2]<8 then
            missing[#missing+1]="L"..(lv+1).."-"..(lv+2).." flights"
        end
    end
    local materials=0
    for _ in pairs(materialSet) do materials=materials+1 end
    local textBody=string.format(
        "%d levels / %d distinct materials / %d walls / %d floor parts / %d ROOF PLANS\n"..
        "%d ornate details / %d glass panes / %d stair treads / %d landings / %d skybridges\n\n"..
        "Stair layout: two SEPARATE parallel flights, a U-turn at half-height, and an upper-floor gallery exit. Ground-floor courtyard is preserved.\n\n",
        floors,materials,counts.wall,counts.floor,counts.roof,counts.detail,counts.glass,
        counts.stairs,counts.landings,counts.bridges)
    if #missing>0 then
        textBody=textBody.."PREVIEW INCOMPLETE: "..table.concat(missing,", ")
    else
        textBody=textBody.."PREVIEW ROUTES PLANNED for every level."
    end
    textBody=textBody.."\n\nRoof plans are NOT installed by the masonry build. Use TEST ONE ROOF, then ADD REAL ROOFS. Check actual stairs and walls before more construction."
    modal("Castle blueprint audit",textBody)
end
local function highlightStairRoute()
    if not previewFolder then beginPreview() end
    if not previewFolder then return end
    for _,p in ipairs(previewFolder:GetChildren()) do
        if p:IsA("BasePart") then
            local route=p.Name=="Stair tread" or p.Name=="Stair landing"
                or p.Name=="South gallery exit" or
                p.Name:find("skybridge",1,true) or
                p.Name:find("connecting gallery",1,true) or
                p.Name=="Rampart skywalk"
            local e=p:FindFirstChildOfClass("SelectionBox")
            if route then
                p.Transparency=.08
                if p.Name=="Stair landing" then
                    p.Color=Color3.fromRGB(246,193,89)
                elseif p.Name=="Stair tread" then
                    p.Color=p:GetAttribute("StairFlight")==1
                        and Color3.fromRGB(75,188,255)
                        or Color3.fromRGB(88,236,174)
                else
                    p.Color=Color3.fromRGB(175,144,241)
                end
                if e then e.Transparency=0;e.LineThickness=.11 end
            else
                p.Transparency=.94
                if e then e.Transparency=.92 end
            end
        end
    end
    notify("Access route highlighted: blue up / green return / gold landings")
end

local function fireUnit(u)
    local eventName=(u.kind=="StairShape" or u.kind=="DetailShape") and "Item" or u.kind
    local r=eventFor(eventName)
    if not r then error("Missing Place"..eventName) end
    if u.kind=="StairShape" or u.kind=="DetailShape" then
        -- The editor sends optional color and material overrides.
        -- Avoid forcing a material enum before a basic block placement
        -- has succeeded; the game can reject unsupported overrides.
        r:FireServer(u.id,"Shapes",u.cf,nil,nil,.25,u.size,u.lv)
    elseif u.kind=="Wall" then
        local diff=u.b-u.a
        local profile=DESIGN_STYLES[state.design] or DESIGN_STYLES[1]
        local desiredColor=u.color or profile.wallColor
        local desiredMaterial=u.material or profile.wall
        local wallId=stairCatalog.wall and stairCatalog.wall.id
        if not wallId then error("No verified solid-wall candidate") end
        -- 3 trailing wall parameters are optional finish fields. The server
        -- must confirm the result; a sent request alone is not success.
        r:FireServer(wallId,"Walls",u.a,u.b,
            Vector3.new(diff.X,0,diff.Z).Magnitude,
            math.atan2(-diff.Z,diff.X),u.a.Y,
            desiredColor,desiredColor,desiredMaterial,u.lv)
    elseif u.kind=="Floor" then
        r:FireServer("32","Floors",u.cf,u.sx,u.sz,u.color,u.material,u.lv)
    elseif u.kind=="Roof" then
        -- Native roof options follow the game's RoofBuilder defaults.
        -- This signature is not trusted for bulk placement until ONE
        -- real Roof model appears after the single-roof test.
        local roofMaterial=Enum.Material[tostring(u.material or "")] or Enum.Material.Slate
        r:FireServer(u.style or "Hip",u.x,u.z,u.sx,u.sz,
            .6,.8,.4,u.color or state.color,roofMaterial,nil,u.lv)
    end
end
local function seeNewWall(plot,before)
    local f=plot:FindFirstChild("Structures")
    if not f then return false end
    for _,child in ipairs(f:GetChildren()) do
        if not before[child] and child:IsA("Model") and
            (child:GetAttribute("WallCFrame") or child:GetAttribute("WallLength")) then
            return true
        end
    end
    return false
end
local function testWall()
    if build.busy then notify("Builder already running");return end
    if not ownedPlot() then
        modal("Plot not recognized","Outlines can appear on a nearby plot, but permanent placement needs verified ownership. Make sure you're building on your own plot.")
        return
    end
    if not ensureCatalog() then notify("Could not read the furniture catalog");return end
    if not stairCatalog.wall then
        modal("No solid wall found",
            "The game's wall catalog did not reveal a non-glass wall. To avoid building another transparent castle, I've stopped the test. Please capture placing an ordinary stone or solid wall and share its event.")
        return
    end
    local units,plot,origin=buildPlan()
    if not units then notify("Could not generate a build plan");return end
    local index
    for i,u in ipairs(units) do if u.kind=="Wall" then index=i;break end end
    if not index or not eventFor("Wall") then notify("Wall event not ready");return end
    build.signature=buildSignature(plot,origin)
    build.passed=false;build.testUnit=units[index];build.cancel=false;build.busy=true
    build.status="Testing "..stairCatalog.wall.name.." (item "..stairCatalog.wall.id..")"
    refreshBuildStatus()
    local before={}
    local folder=plot:FindFirstChild("Structures")
    if folder then for _,child in ipairs(folder:GetChildren()) do before[child]=true end end
    task.spawn(function()
        local ok,err=pcall(function() fireUnit(units[index]) end)
        local confirmed=false
        local glassFound=false
        if ok then
            for _=1,30 do
                if not alive or build.cancel then break end
                local refreshed=plot:FindFirstChild("Structures")
                if refreshed then
                    for _,item in ipairs(refreshed:GetChildren()) do
                        if item:IsA("Model") and not before[item]
                            and item:GetAttribute("WallLength") then
                            glassFound=isGlassModel(item)
                            confirmed=not glassFound
                            break
                        end
                    end
                end
                if confirmed or glassFound then break end
                task.wait(.18)
            end
        end
        build.busy=false
        if confirmed then
            build.passed=true
            build.status="Wall test passed: ready to continue"
            notify("One wall placed! START BUILD is now available.")
        else
            build.status=glassFound and "Wall is still transparent: build halted" or
                (ok and "Solid wall not confirmed; build halted" or "Wall remote error")
            notify(build.status..(ok and "" or ": "..tostring(err):sub(1,90)))
        end
        refreshBuildStatus()
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end

local function testStairShape()
    if build.busy then notify("A build is already running");return end
    local plot=ownedPlot()
    local origin=plot and plotFrame(plot)
    if not origin then
        notify("Owned plot not detected; cannot place staircase")
        return
    end
    if not stairCatalog.scanned or not stairCatalog.shape then
        if not ensureCatalog() or not stairCatalog.shape then
            modal("No verified block shape","The catalog scanner could not find a block or cube in the game's Shapes category. Use the build editor to place a block, capture its PlaceItem event and send it to me.")
            return
        end
    end
    if state.floors<2 then
        notify("Choose at least two storeys to test a staircase")
        return
    end
    if not eventFor("Item") then
        notify("PlaceItem is unavailable")
        return
    end
    local stairs=rawStairUnits(plot,origin)
    if #stairs==0 then notify("No stair treads in this blueprint");return end
    local target
    for _,unit in ipairs(stairs) do
        if not stairsAlreadyPresent(plot,unit) then target=unit;break end
    end
    if not target then
        notify("All candidate stair positions already have matching shapes")
        return
    end
    build.busy=true;build.cancel=false
    build.status="Testing one real stair tread..."
    refreshBuildStatus()
    local snapshot={}
    for _,obj in ipairs(shapeModels(plot)) do snapshot[obj]=true end
    task.spawn(function()
        local fired,err=pcall(function() fireUnit(target) end)
        local accepted=false
        if fired then
            for n=1,22 do
                if not alive or build.cancel then break end
                if verifyPlacedStair(plot,target,snapshot) then accepted=true;break end
                task.wait(.2)
            end
        end
        build.busy=false
        local modelsAfter=shapeModels(plot)
        local newCount=0
        for _,m in ipairs(modelsAfter) do
            if not snapshot[m] then newCount=newCount+1 end
        end
        local p=target.cf.Position
        build.lastAudit="SHAPE PLACEMENT DIAGNOSTIC\n"..
            "Shape: "..tostring(stairCatalog.shape and stairCatalog.shape.name)..
            " (ID "..tostring(target.id)..")\n"..
            "Position: ("..math.floor(p.X+.5)..","..
                math.floor(p.Y+.5)..","..math.floor(p.Z+.5)..")\n"..
            "Requested dimensions: "..tostring(target.size)..
            "\nStorey: "..tostring(target.lv)..
            "\nShapes before: "..tostring(#modelsAfter-newCount)..
            "\nNew shape-like models: "..newCount..
            "\nConfirmed matching walkable Shape: "..tostring(accepted)..
            "\nRequest call succeeded: "..tostring(fired)..
            "\nCall error (if any): "..tostring(err or "none")..
            "\nA sent event does not mean the server accepted the Shape."
        if accepted then
            stairTest.passed=true
            stairTest.signature=buildSignature(plot,origin)
            stairTest.itemId=target.id
            stairTest.first=target
            build.status="Stair tread verified; stair construction ready"
            notify("Stair shape placed and confirmed. Stair construction enabled.")
        else
            stairTest.passed=false
            build.status="Optional Shape test unconfirmed; shell, roof, doors and wings remain available"
            notify(fired and build.status or ("Stair test failed: "..tostring(err):sub(1,85)))
        end
        refreshBuildStatus()
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end


-- Convert carefully selected preview ornaments into a real editable Shapes plan.
-- Large strips are partitioned into smaller pieces; no untested shape IDs.
local function ornateDetailUnits(plot,origin,maxUnits)
    local result={}
    if not previewFolder then beginPreview() end
    if not previewFolder or not stairCatalog.shape then return result end
    local h=15
    pcall(function()
        local cfg=require(game:GetService("ReplicatedStorage").Modules.PlotConfig)
        if type(cfg.StoreyHeight)=="number" then h=cfg.StoreyHeight end
    end)
    h=math.clamp(h,6,30)
    local prioritized={}
    local function rank(name)
        local low=name:lower()
        -- First make the accessible entrance/courtyard look finished;
        -- very tall spires are often outside the build height and fail.
        if low:find("column",1,true) or low:find("capital",1,true) then return 100 end
        if low:find("cornice",1,true) or low:find("keystone",1,true) then return 95 end
        if low:find("lintel",1,true) or low:find("sill",1,true) then return 90 end
        if low:find("battlement",1,true) or low:find("merlon",1,true) then return 80 end
        if low:find("spire",1,true) or low:find("finial",1,true) then return 10 end
        if low:find("gate",1,true) or low:find("portcullis",1,true) then return 78 end
        if low:find("lantern",1,true) or low:find("banner",1,true) then return 75 end
        if low:find("balustrade",1,true) or low:find("railing",1,true) then return 70 end
        if low:find("lintel",1,true) or low:find("sill",1,true) then return 67 end
        return 25
    end
    for _,p in ipairs(previewFolder:GetChildren()) do
        if p:IsA("BasePart") and p:GetAttribute("PlotStudioKind")=="Decor" and
            not p.Name:lower():find("stair",1,true) and
            not p.Name:lower():find("landing",1,true) then
            prioritized[#prioritized+1]={part=p,priority=rank(p.Name)}
        end
    end
    table.sort(prioritized,function(a,b)
        if a.priority~=b.priority then return a.priority>b.priority end
        return a.part.Name<b.part.Name
    end)
    local cap=maxUnits or 220
    local layerMax=math.min(state.floors,(designs[state.design] or designs[1]).floors)
    local plotW,plotD=getFootprint(plot)
    for _,entry in ipairs(prioritized) do
        if #result>=cap then break end
        local p=entry.part
        local height=p.Position.Y-origin.Position.Y
        -- Skip extreme finials above the build envelope, rather than aborting
        -- the remaining ornamentation with an out-of-height request.
        if height-p.Size.Y*.5>=-.25 and
            height+p.Size.Y*.5<=layerMax*h+2 then
            local countX=math.ceil(p.Size.X/12)
            local countY=math.ceil(p.Size.Y/12)
            local countZ=math.ceil(p.Size.Z/12)
            if countX*countY*countZ<=20 then
                local sx,sy,sz=p.Size.X/countX,p.Size.Y/countY,p.Size.Z/countZ
                for ix=1,countX do
                    for iy=1,countY do
                        for iz=1,countZ do
                            if #result>=cap then break end
                            local cf=p.CFrame*CFrame.new(
                                (ix-(countX+1)/2)*sx,
                                (iy-(countY+1)/2)*sy,
                                (iz-(countZ+1)/2)*sz
                            )
                            local localPos=origin:PointToObjectSpace(cf.Position)
                            if math.abs(localPos.X)+sx*.5<plotW*.5-1
                                and math.abs(localPos.Z)+sz*.5<plotD*.5-1 and
                                localPos.Y-sy*.5>=-.25 and
                                localPos.Y+sy*.5<=layerMax*h+2 then
                                result[#result+1]={
                                    kind="DetailShape",id=stairCatalog.shape.id,cf=cf,
                                    size=Vector3.new(sx,sy,sz),
                                    color=p:GetAttribute("PlotStudioColor"),
                                    material=p:GetAttribute("PlotStudioMaterial"),
                                    lv=math.clamp(math.floor(localPos.Y/h),0,4)
                                }
                            end
                        end
                    end
                end
            end
        end
    end
    return result
end
-- A test success is a session flag, not proof that already placed
-- Shapes disappeared. Recognize multiple existing walkable Shapes that
-- line up with this blueprint before asking for a fresh test.
local function adoptExistingStairs(plot,origin)
    if not stairCatalog.shape then return false end
    local sig=buildSignature(plot,origin)
    if stairTest.passed and stairTest.signature==sig
        and stairTest.itemId==stairCatalog.shape.id then
        return true
    end
    local planned=rawStairUnits(plot,origin)
    local existing=shapeModels(plot)
    if #existing==0 or #planned==0 then return false end
    local found,seen=0,{}
    for _,u in ipairs(planned) do
        if stairsAlreadyPresent(plot,u) then
            found=found+1
        else
            -- The game may scale a Shape differently from its requested
            -- bounding box. For adoption only, use close walkable blocks;
            -- the strict size test still controls whether a unit is skipped.
            for _,m in ipairs(existing) do
                if m:IsA("Model") and not seen[m] and
                    (tostring(m:GetAttribute("ItemId") or "")==
                        tostring(stairCatalog.shape.id) or
                    m:GetAttribute("Category")=="Shapes") then
                    local ok,p=pcall(function() return m:GetPivot().Position end)
                    if ok and (p-u.cf.Position).Magnitude<2.4 then
                        local walkable=false
                        for _,piece in ipairs(m:GetDescendants()) do
                            if piece:IsA("BasePart") and piece.CanCollide
                                and piece.CFrame.UpVector.Y>.7 then
                                walkable=true;break
                            end
                        end
                        if walkable then
                            found=found+1
                            seen[m]=true
                            break
                        end
                    end
                end
            end
        end
        if found>=2 then
            stairTest.passed=true
            stairTest.signature=sig
            stairTest.itemId=stairCatalog.shape.id
            stairTest.first=u
            return true
        end
    end
    return false
end

local function staircaseAndDetails(plot,origin)
    local result,skipped={},0
    if not adoptExistingStairs(plot,origin) then
        return nil,"No verified stair test or matching existing walkable Shapes. TEST STAIR TREAD only if building new stairs."
    end
    local stairs=rawStairUnits(plot,origin)
    local details=ornateDetailUnits(plot,origin,260)
    for _,u in ipairs(stairs) do
        if not stairsAlreadyPresent(plot,u) then
            result[#result+1]=u
        else skipped=skipped+1 end
    end
    for _,u in ipairs(details) do
        if not stairsAlreadyPresent(plot,u) then
            result[#result+1]=u
        else skipped=skipped+1 end
    end
    return result,nil,#stairs,#details,skipped
end
-- Repairs missing START, U-turn and EXIT landings independently of
-- decorative ornaments. Existing verified treads are never re-sent.
local function repairStairGaps()
    if build.busy then notify("A build is already running");return end
    if not ensureCatalog() or not stairCatalog.shape then
        notify("No Shapes catalog item available");return
    end
    local plot=ownedPlot()
    local origin=plot and plotFrame(plot)
    if not origin then notify("Owned plot required");return end
    beginPreview()
    local all,err=staircaseAndDetails(plot,origin)
    local verified=all~=nil
    if not all then
        -- The user may have visually usable staircase Shapes in a
        -- different plot folder or different version of the blueprint.
        -- Allow a SINGLE missing landing attempt instead of refusing
        -- the entire repair action. Never speculate a 45-item batch.
        all={}
        for _,u in ipairs(rawStairUnits(plot,origin)) do
            if u.label=="Stair landing" and not stairsAlreadyPresent(plot,u) then
                all[#all+1]=u
            end
        end
        notify("Shape test unconfirmed; checking ONE missing landing only. Other construction remains available.")
    end
    local missing={}
    for _,u in ipairs(all) do
        if u.kind=="StairShape" then missing[#missing+1]=u end
    end
    if #missing==0 then
        notify("No missing SIZE-VERIFIED stair units in the blueprint. Check the physical landings before changing anything.")
        return
    end
    table.sort(missing,function(a,b)
        local function priority(u)
            if u.role=="Exit" then return 100 end
            if u.role=="Start" and u.lv>=1 then return 95 end
            if u.role=="Turn" then return 85 end
            if u.role=="Start" then return 20 end
            return 10
        end
        if priority(a)~=priority(b) then return priority(a)>priority(b) end
        if a.lv~=b.lv then return a.lv<b.lv end
        return a.cf.Position.Y<b.cf.Position.Y
    end)
    build.busy=true;build.cancel=false
    build.total=#missing;build.sent=0
    build.status="Repairing missing staircase connections..."
    refreshBuildStatus()
    task.spawn(function()
        local confirmed,failed,consecutive=0,0,0
        for i=1,math.min(#missing,verified and 45 or 1) do
            local u=missing[i]
            if not alive or build.cancel or consecutive>=3 then break end
            if not stairsAlreadyPresent(plot,u) then
                local ok,errText=pcall(function() fireUnit(u) end)
                if not ok then
                    build.status="Stair repair error: "..tostring(errText):sub(1,75)
                    failed=failed+1
                    break
                end
                build.sent=build.sent+1
                local found=false
                for attempt=1,12 do
                    if not alive or build.cancel then break end
                    if stairsAlreadyPresent(plot,u) then found=true;break end
                    task.wait(.18)
                end
                if found then confirmed=confirmed+1;consecutive=0
                else failed=failed+1;consecutive=consecutive+1 end
            end
            build.status="Stair connections: "..confirmed..
                " confirmed / "..failed.." unconfirmed"
            refreshBuildStatus()
        end
        build.busy=false
        build.lastAudit="STAIR GAP AUDIT\n"..
            "Missing before repair: "..#missing..
            "\nNewly confirmed: "..confirmed..
            "\nUnconfirmed: "..failed..
            "\nNo duplicate placement retries. Check the physical path."
        build.status=build.cancel and "Stair gap repair stopped" or
            ("Stair repair: "..confirmed.." confirmed / "..failed..
            " unconfirmed / "..#missing.." originally missing")
        refreshBuildStatus()
        notify(build.status)
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end

local function finishCastle()
    if build.busy then notify("Construction already running");return end
    local plot=ownedPlot()
    local origin=plot and plotFrame(plot)
    if not origin then notify("Owned plot not detected");return end
    if not ensureCatalog() or not stairCatalog.shape then
        notify("No Shapes block detected; finish mode unavailable")
        return
    end
    local units,err,stairs,details,skipped=staircaseAndDetails(plot,origin)
    local verifiedStairs=units~=nil
    if not units then
        -- Detail-only finishing is independent of Shape stair verification.
        -- Try a small bounded number of ornament placements and stop
        -- immediately if real replication checks fail.
        units={}
        for _,u in ipairs(ornateDetailUnits(plot,origin,260)) do
            if not stairsAlreadyPresent(plot,u) then units[#units+1]=u end
        end
        stairs=0
        details=#units
        skipped=0
        notify("Stair confirmation unavailable; decoration-only mode. No staircase automation will be triggered.")
    end
    if #units==0 then
        notify("No eligible missing Shapes in the current plan. This does NOT mean the castle is complete. Check the actual build audit.")
        return
    end
    if not eventFor("Item") then notify("PlaceItem event missing");return end
    local hasRealMasonry=false
    local structures=plot:FindFirstChild("Structures")
    if structures then
        for _,m in ipairs(structures:GetChildren()) do
            if m:IsA("Model") and typeof(m:GetAttribute("WallCFrame"))=="CFrame" then
                hasRealMasonry=true
                break
            end
        end
    end
    if not hasRealMasonry then
        notify("Build the structural walls first. Decorations cannot lead the build.")
        return
    end
    local pace=BUILD_SPEEDS[state.buildSpeed] or BUILD_SPEEDS.Fast
    build.busy=true;build.cancel=false
    build.total=#units;build.sent=0
    build.status="Finishing: 0 / "..#units.." Shapes"
    refreshBuildStatus()
    notify("Attempting up to 85 verified Shape placements this run; "..stairs..
        " stair units and "..details.." decorative units are planned")
    task.spawn(function()
        local sent,confirmed,failed,skip,consecutive=0,0,0,skipped,0
        local stairOK,detailOK=0,0
        local cap=math.min(#units,verifiedStairs and 85 or 12)
        for i=1,cap do
            local u=units[i]
            if not alive or build.cancel then break end
            if stairsAlreadyPresent(plot,u) then
                skip=skip+1
            else
                local ok,errText=pcall(function() fireUnit(u) end)
                if not ok then
                    build.status="Finish stopped: "..tostring(errText):sub(1,70)
                    break
                end
                sent=sent+1
                build.sent=sent
                local found=false
                for attempt=1,12 do
                    if not alive or build.cancel then break end
                    if stairsAlreadyPresent(plot,u) then found=true;break end
                    task.wait(.16)
                end
                if found then
                    confirmed=confirmed+1
                    consecutive=0
                    if u.kind=="StairShape" then stairOK=stairOK+1
                    else detailOK=detailOK+1 end
                else
                    failed=failed+1
                    consecutive=consecutive+1
                end
                build.status="Finish: "..confirmed.." confirmed / "..failed..
                    " unconfirmed / "..skip.." already there"
                refreshBuildStatus()
                if consecutive>=3 then
                    build.status="STOPPED: 3 consecutive unconfirmed Shapes. Check the audit."
                    break
                end
                task.wait(math.max(.15,pace.interval))
            end
        end
        build.busy=false
        build.lastAudit="SHAPE FINISH AUDIT\n"..
            "Confirmed: "..confirmed.." (stairs "..stairOK..
            ", details "..detailOK..")\n"..
            "Unconfirmed: "..failed.."\n"..
            "Already verified in plot: "..skip.."\n"..
            "Attempted this run: "..sent.." / eligible: "..#units..
            "\nRun cap: "..cap.."; sent never means placed."..
            "\nUnconfirmed pieces are not proof of server rejection."
        if build.cancel then build.status="Finishing stopped at "..sent
        elseif build.status:find("Finish stopped",1,true) or
            build.status:find("STOPPED:",1,true) then
            -- Preserve the failure reason.
        else
            build.status="Finished: "..confirmed.." confirmed / "..failed..
                " unconfirmed; "..math.max(0,#units-cap).." not attempted"
        end
        refreshBuildStatus()
        notify(build.status)
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end

-- Real structural windows are placed through PlaceWindow, NOT by layering
-- glass panels or Shape lintels over solid walls. The game's editor supplies
-- a wall GUID for WallSnap, so only server-created wall models are eligible.
local function nativeWindowModels(plot)
    local result={}
    for _,folderName in ipairs({"Structures","Furniture"}) do
        local folder=plot:FindFirstChild(folderName)
        if folder then
            for _,m in ipairs(folder:GetChildren()) do
                local itemId=m:GetAttribute("ItemId")
                local known=itemId and
                    buildCatalog.byId["Windows|"..tostring(itemId)]
                if m:IsA("Model") and (m:GetAttribute("Category")=="Windows" or
                    m:GetAttribute("ItemCategory")=="Windows" or known~=nil) then
                    result[#result+1]=m
                end
            end
        end
    end
    return result
end
local function nativeWindowTargets(plot,origin)
    local result={}
    local folder=plot:FindFirstChild("Structures")
    if not folder then return result end
    local h=15
    pcall(function()
        local cfg=require(game:GetService("ReplicatedStorage").Modules.PlotConfig)
        if type(cfg.StoreyHeight)=="number" then h=cfg.StoreyHeight end
    end)
    h=math.clamp(h,6,30)
    for _,wall in ipairs(folder:GetChildren()) do
        if wall:IsA("Model") then
            local cf=wall:GetAttribute("WallCFrame")
            local length=wall:GetAttribute("WallLength")
            local guid=wall:GetAttribute("GUID")
            if typeof(cf)=="CFrame" and type(length)=="number" and length>=13
                and guid~=nil then
                local lv=wall:GetAttribute("Storey")
                if type(lv)~="number" then
                    lv=math.floor((cf.Position.Y-origin.Position.Y)/h+.1)
                end
                lv=math.floor(lv)
                if lv>=0 and lv<=4 then
                    local height=wall:GetAttribute("WallHeight")
                    if type(height)~="number" then height=h end
                    -- Doorway lintels and half-height walls cannot host
                    -- a full structural window. Do not try them.
                    if height>=h*.75 then
                        local center=Vector3.new(cf.Position.X,
                            origin.Position.Y+lv*h+math.min(height*.52,h*.56),
                            cf.Position.Z)
                        local pivot=CFrame.new(center)*cf.Rotation
                        result[#result+1]={
                            model=wall,cf=pivot,wallCF=cf,length=length,
                            guid=tostring(guid),lv=lv
                        }
                    end
                end
            end
        end
    end
    table.sort(result,function(a,b)
        -- Prefer a first-floor wall for the single-window test; the top
        -- storeys may be locked even when they appear in the preview.
        local pa=math.abs(a.lv-1)
        local pb=math.abs(b.lv-1)
        if pa~=pb then return pa<pb end
        return a.length>b.length
    end)
    return result
end
local function windowAlreadyAt(plot,position)
    for _,m in ipairs(nativeWindowModels(plot)) do
        local ok,cf=pcall(function() return m:GetPivot() end)
        if ok and (cf.Position-position).Magnitude<6 then return true end
    end
    -- Never put a new window through an existing native doorway.
    local structures=plot:FindFirstChild("Structures")
    if structures then
        for _,m in ipairs(structures:GetChildren()) do
            if m:IsA("Model") and (m:GetAttribute("Category")=="Doors" or
                m:GetAttribute("ItemCategory")=="Doors") then
                local ok,cf=pcall(function() return m:GetPivot() end)
                if ok and (cf.Position-position).Magnitude<6 then return true end
            end
        end
    end
    return false
end
local function confirmedNewWindow(plot,before,position,windowId)
    for _,m in ipairs(nativeWindowModels(plot)) do
        if not before[m] then
            local id=m:GetAttribute("ItemId")
            local ok,cf=pcall(function() return m:GetPivot() end)
            if (id==nil or tostring(id)==tostring(windowId)) and
                ok and (cf.Position-position).Magnitude<10 then
                return true
            end
        end
    end
    return false
end
local function testNativeWindow()
    if build.busy then notify("Finish the current construction job first");return end
    if not ensureCatalog() or not nativeWindow.id then
        notify("No native Windows item discovered. Rescan the Build Catalog.")
        return
    end
    local remote=eventFor("Window")
    if not remote then notify("PlaceWindow event is unavailable");return end
    local plot=ownedPlot()
    local origin=plot and plotFrame(plot)
    if not origin then notify("No owned plot found");return end
    local target
    for _,candidate in ipairs(nativeWindowTargets(plot,origin)) do
        if not windowAlreadyAt(plot,candidate.cf.Position) then
            target=candidate;break
        end
    end
    if not target then
        notify("No free, server-confirmed wall for a native window. Build masonry first.")
        return
    end
    local before={}
    for _,m in ipairs(nativeWindowModels(plot)) do before[m]=true end
    local itemId=nativeWindow.id
    build.busy=true;build.cancel=false
    build.status="Testing one native "..tostring(nativeWindow.name).." window..."
    refreshBuildStatus()
    task.spawn(function()
        local ok,err=pcall(function()
            remote:FireServer(itemId,"Windows",target.cf,target.guid,
                nil,nil,target.lv)
        end)
        local passed=false
        if ok then
            for i=1,24 do
                if build.cancel or not alive then break end
                if confirmedNewWindow(plot,before,target.cf.Position,itemId) then
                    passed=true;break
                end
                task.wait(.2)
            end
        end
        nativeWindow.passed=passed
        nativeWindow.signature=passed and
            (plot.Name.."|"..tostring(itemId)) or nil
        nativeWindow.status=passed and
            ("VERIFIED native window: "..tostring(nativeWindow.name)) or
            ("Native window not confirmed; no bulk windows allowed")
        build.busy=false
        build.status=nativeWindow.status
        refreshBuildStatus()
        notify(nativeWindow.status..
            (not ok and (" / "..tostring(err):sub(1,90)) or ""))
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end
local function addNativeWindows()
    if build.busy then notify("Another build job is running");return end
    local plot=ownedPlot()
    local origin=plot and plotFrame(plot)
    if not origin or not nativeWindow.passed or
        nativeWindow.signature~=(plot.Name.."|"..tostring(nativeWindow.id)) then
        notify("TEST ONE NATIVE WINDOW must succeed before adding more.")
        return
    end
    local remote=eventFor("Window")
    if not remote then notify("PlaceWindow unavailable");return end
    local targets=nativeWindowTargets(plot,origin)
    if #targets==0 then notify("No confirmed structural walls found");return end
    build.busy=true;build.cancel=false
    build.status="Installing native windows on existing walls..."
    refreshBuildStatus()
    task.spawn(function()
        local placed,skipped,rejected=0,0,0
        for _,target in ipairs(targets) do
            if not alive or build.cancel or placed>=28 or rejected>=2 then break end
            if windowAlreadyAt(plot,target.cf.Position) then
                skipped=skipped+1
            else
                local before={}
                for _,m in ipairs(nativeWindowModels(plot)) do before[m]=true end
                local ok,err=pcall(function()
                    remote:FireServer(nativeWindow.id,"Windows",target.cf,
                        target.guid,nil,nil,target.lv)
                end)
                local confirmed=false
                if ok then
                    for i=1,18 do
                        if build.cancel or not alive then break end
                        if confirmedNewWindow(plot,before,target.cf.Position,
                            nativeWindow.id) then
                            confirmed=true;break
                        end
                        task.wait(.2)
                    end
                end
                if confirmed then
                    placed=placed+1
                    rejected=0
                else
                    rejected=rejected+1
                    if not ok then
                        notify("Native window request failed: "..
                            tostring(err):sub(1,75))
                    end
                end
                build.status="Native windows: "..placed..
                    " confirmed / "..skipped.." occupied / "..rejected..
                    " consecutive unconfirmed"
                refreshBuildStatus()
                task.wait(.18)
            end
        end
        build.busy=false
        build.status=build.cancel and "Native window installation stopped" or
            ("Native windows: "..placed.." confirmed / "..skipped..
            " already occupied / stopped after "..rejected..
            " consecutive failures")
        refreshBuildStatus()
        notify(build.status)
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end

-- First-floor doors are actual Doors catalog items, not a Shape panel.
-- Only test at the authored ground-floor opening. The editor may require
-- WallSnap for some styles; if PlaceItem fails, STOP instead of guessing.
local function entrancePosition(plot,origin)
    if not previewFolder then beginPreview() end
    local selected,score
    if not previewFolder then return nil end
    for _,p in ipairs(previewFolder:GetChildren()) do
        if p:IsA("BasePart") and
            p:GetAttribute("PlotStudioKind")=="Entrance" then
            local relative=origin:ToObjectSpace(p.CFrame)
            local value=math.abs(relative.Position.X)*3+
                math.abs(relative.Position.Z)*.05
            if not score or value<score then
                selected=p;score=value
            end
        end
    end
    if not selected then return nil end
    return selected.CFrame,selected.Size
end
local function realDoors(plot)
    local out={}
    for _,folderName in ipairs({"Furniture","Structures"}) do
        local folder=plot:FindFirstChild(folderName)
        if folder then
            for _,m in ipairs(folder:GetChildren()) do
                if m:IsA("Model") then
                    local id=m:GetAttribute("ItemId")
                    local known=id and
                        buildCatalog.byId["Doors|"..tostring(id)]
                    if known or m:GetAttribute("Category")=="Doors" or
                        m:GetAttribute("ItemCategory")=="Doors" then
                        out[#out+1]=m
                    end
                end
            end
        end
    end
    return out
end
local function newDoorConfirmed(plot,before,position,itemId)
    for _,m in ipairs(realDoors(plot)) do
        if not before[m] then
            local id=m:GetAttribute("ItemId")
            local ok,cf=pcall(function() return m:GetPivot() end)
            if ok and (id==nil or tostring(id)==tostring(itemId)) and
                Vector2.new(cf.Position.X-position.X,
                    cf.Position.Z-position.Z).Magnitude<7 and
                math.abs(cf.Position.Y-position.Y)<10 then
                return true
            end
        end
    end
    return false
end
local function testNativeDoor()
    if build.busy then notify("A build is already running");return end
    if not ensureCatalog() or not nativeDoor.id then
        notify("No real Doors item found. Scan or select from the catalog.")
        return
    end
    local r=eventFor("Item")
    if not r then notify("PlaceItem event missing");return end
    local plot=ownedPlot()
    local origin=plot and plotFrame(plot)
    if not origin then notify("Owned plot not detected");return end
    beginPreview()
    local cf=entrancePosition(plot,origin)
    if not cf then notify("No first-floor entrance marked in this design");return end
    -- A previous version could place a full-height PlaceWall lintel
    -- across the entrance. Do not hide it with a door prop.
    for _,wall in ipairs(occupiedFromPlot(plot,origin)) do
        if wall.kind=="Wall" and wall.lv==0 then
            local ab=wall.b-wall.a
            local length2=ab.X*ab.X+ab.Z*ab.Z
            if length2>0 then
                local ap=cf.Position-wall.a
                local t=math.clamp((ap.X*ab.X+ap.Z*ab.Z)/length2,0,1)
                local closest=wall.a+ab*t
                local dx,dz=cf.Position.X-closest.X,cf.Position.Z-closest.Z
                if math.sqrt(dx*dx+dz*dz)<1.6 then
                    notify("Old masonry blocks the front entrance. Remove only that doorway wall segment in the game before testing a door; do not bulldoze.")
                    return
                end
            end
        end
    end
    for _,m in ipairs(realDoors(plot)) do
        local ok,p=pcall(function() return m:GetPivot() end)
        if ok and (p.Position-cf.Position).Magnitude<8 then
            notify("A real door is already near this entrance. No duplicate sent.")
            return
        end
    end
    local before={}
    for _,m in ipairs(realDoors(plot)) do before[m]=true end
    local id=nativeDoor.id
    build.busy=true;build.cancel=false
    build.status="Testing ONE real ground-floor door..."
    refreshBuildStatus()
    task.spawn(function()
        local ok,err=pcall(function()
            r:FireServer(id,"Doors",cf,nil,nil,.25,nil,0)
        end)
        local passed=false
        if ok then
            for i=1,24 do
                if not alive or build.cancel then break end
                if newDoorConfirmed(plot,before,cf.Position,id) then
                    passed=true;break
                end
                task.wait(.25)
            end
        end
        nativeDoor.passed=passed
        nativeDoor.signature=passed and
            (plot.Name.."|"..tostring(id)) or nil
        nativeDoor.status=passed and
            ("Ground-floor door CONFIRMED: "..tostring(nativeDoor.name)) or
            "Door not confirmed. No additional door requests sent."
        build.busy=false
        build.status=nativeDoor.status
        refreshBuildStatus()
        notify(nativeDoor.status..
            (not ok and (" / "..tostring(err):sub(1,70)) or ""))
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end

-- Add narrow, confirmed Shape trim ONLY around an actual placed door.
-- Never put a solid panel across the middle of the entrance.
local function repairDoorGaps()
    if build.busy then notify("Finish the active build first");return end
    if not ensureCatalog() or not stairCatalog.shape then
        notify("Shape style not available. Cannot attempt doorway trim.")
        return
    end
    local plot=ownedPlot()
    local origin=plot and plotFrame(plot)
    if not origin then notify("Owned plot not detected");return end
    beginPreview()
    local entrance,markerSize=entrancePosition(plot,origin)
    if not entrance then notify("Current design has no entrance marker");return end
    local selected,doorCF,doorSize
    for _,model in ipairs(realDoors(plot)) do
        local ok,cf,size=pcall(function() return model:GetBoundingBox() end)
        if ok and
            Vector2.new(cf.Position.X-entrance.Position.X,
                cf.Position.Z-entrance.Position.Z).Magnitude<10 then
            selected=model;doorCF=cf;doorSize=size
            break
        end
    end
    if not selected then
        notify("No real ground-floor Door model near the blueprint entrance.")
        return
    end
    -- BoundingBox width is world-axis aligned. When the door is rotated,
    -- do not infer side gaps from it: avoid covering a functional doorway.
    if math.abs(doorCF.RightVector:Dot(entrance.RightVector))<.88 then
        notify("Door and entrance orientation differ; refusing unsafe trim.")
        return
    end
    local localDoor=entrance:PointToObjectSpace(doorCF.Position)
    local width=markerSize.X
    local doorW=doorSize.X
    local leftGap=(localDoor.X-doorW*.5)-(-width*.5)
    local rightGap=width*.5-(localDoor.X+doorW*.5)
    local units={}
    local h=math.min(9,markerSize.Y-1)
    local function side(gap,edge,left)
        if gap<.75 or gap>8 then return end
        local x=left and (-width*.5+gap*.5) or
            (width*.5-gap*.5)
        units[#units+1]={
            kind="DetailShape",id=stairCatalog.shape.id,
            cf=entrance*CFrame.new(x,0,0),
            size=Vector3.new(math.max(.5,gap-.25),h,.7),
            lv=0,label=left and "Door left jamb" or "Door right jamb",
            color=nil,material=nil
        }
    end
    side(leftGap,1,true)
    side(rightGap,1,false)
    if #units==0 then
        notify("Door opening already fits or the measured gap is unsupported.")
        return
    end
    build.busy=true
    build.cancel=false
    build.status="Trying real doorway Shape trim..."
    refreshBuildStatus()
    task.spawn(function()
        local accepted,missing=0,0
        local notes={}
        for _,u in ipairs(units) do
            if not alive or build.cancel or missing>0 then break end
            if stairsAlreadyPresent(plot,u) then
                accepted=accepted+1
            else
                local before={}
                for _,m in ipairs(shapeModels(plot)) do before[m]=true end
                local ok,err=pcall(function() fireUnit(u) end)
                local confirmed=false
                if ok then
                    for step=1,18 do
                        if not alive or build.cancel then break end
                        if verifyPlacedStair(plot,u,before) then
                            confirmed=true;break
                        end
                        task.wait(.2)
                    end
                end
                if confirmed then accepted=accepted+1
                else
                    missing=missing+1
                    notes[#notes+1]=u.label.." not confirmed"..
                        (not ok and (" / "..tostring(err):sub(1,70)) or "")
                end
            end
            build.status="Door trim: "..accepted.." confirmed / "..
                missing.." unconfirmed"
            refreshBuildStatus()
        end
        build.busy=false
        build.lastAudit="DOOR OPENING REPAIR\n"..
            "Door width: "..(math.floor(doorW*100+.5)/100)..
            "\nOpening width: "..(math.floor(width*100+.5)/100)..
            "\nLeft/right measured gaps: "..
                (math.floor(leftGap*100+.5)/100).."/"..
                (math.floor(rightGap*100+.5)/100)..
            "\nSide trim confirmed: "..accepted..
            "\nUnconfirmed: "..missing..
            "\n"..table.concat(notes,"\n")..
            "\nNo parts of the real door were modified."
        build.status="Door trim: "..accepted.." confirmed / "..
            missing.." unconfirmed"
        refreshBuildStatus()
        notify(build.status)
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end

-- Native pitched roofs are a separate, verified stage. Never send a
-- 70-request speculative roof batch: test ONE, confirm a new plot roof,
-- then add a few more with per-roof replication checks.
local roofTest={passed=false,signature=nil,status="No real roof tested yet"}
local function plannedRoofs(plot,origin)
    if not previewFolder then beginPreview() end
    local result={}
    if not previewFolder then return result end
    local h=15
    pcall(function()
        local cfg=require(game:GetService("ReplicatedStorage").Modules.PlotConfig)
        if type(cfg.StoreyHeight)=="number" then h=cfg.StoreyHeight end
    end)
    h=math.clamp(h,6,30)
    for _,p in ipairs(previewFolder:GetChildren()) do
        if p:IsA("BasePart") and p:GetAttribute("PlotStudioKind")=="Roof" then
            local cf=origin:ToObjectSpace(p.CFrame)
            result[#result+1]={
                kind="Roof",x=cf.Position.X,z=cf.Position.Z,
                sx=p.Size.X,sz=p.Size.Z,
                lv=math.clamp(math.floor((cf.Position.Y+.4)/h+.1)-1,0,4),
                style=p:GetAttribute("PlotStudioRoofStyle") or "Hip",
                color=p:GetAttribute("PlotStudioColor"),
                material=p:GetAttribute("PlotStudioMaterial"),
                zone=p:GetAttribute("PlotStudioZone")
            }
        end
    end
    return result
end
local function realRoofs(plot)
    local out={}
    for _,name in ipairs({"Roofs","Structures"}) do
        local folder=plot:FindFirstChild(name)
        if folder then
            for _,m in ipairs(folder:GetChildren()) do
                if (m:IsA("Model") or m:IsA("BasePart")) and
                    (name=="Roofs" or m:GetAttribute("RoofStyle")~=nil or
                    m:GetAttribute("Category")=="Roofs") then
                    out[#out+1]=m
                end
            end
        end
    end
    return out
end
local function roofCenter(origin,u)
    return origin:PointToWorldSpace(Vector3.new(u.x,0,u.z))
end
local function roofSupported(plot,origin,u)
    local structures=plot:FindFirstChild("Structures")
    if not structures then return false end
    local count=0
    local h=15
    pcall(function()
        local cfg=require(game:GetService("ReplicatedStorage").Modules.PlotConfig)
        if type(cfg.StoreyHeight)=="number" then h=cfg.StoreyHeight end
    end)
    h=math.clamp(h,6,30)
    for _,m in ipairs(structures:GetChildren()) do
        if m:IsA("Model") then
            local cf=m:GetAttribute("WallCFrame")
            if typeof(cf)=="CFrame" then
                local p=origin:PointToObjectSpace(cf.Position)
                local lv=m:GetAttribute("Storey")
                if type(lv)~="number" then lv=math.floor(p.Y/h) end
                if (math.floor(lv)==u.lv or
                    math.abs(p.Y-(u.lv+.5)*h)<h*.65) and
                    math.abs(p.X-u.x)<u.sx*.62 and
                    math.abs(p.Z-u.z)<u.sz*.62 then
                    count=count+1
                    if count>=2 then return true end
                end
            end
        end
    end
    return false
end
local function roofAt(plot,origin,u)
    local point=roofCenter(origin,u)
    for _,m in ipairs(realRoofs(plot)) do
        local ok,cf=pcall(function() return m:GetPivot() end)
        if ok then
            local p=cf.Position
            if Vector2.new(p.X-point.X,p.Z-point.Z).Magnitude<math.max(6,math.min(u.sx,u.sz)*.18)
                and math.abs(p.Y-origin.Position.Y-(u.lv+1)*15)<24 then
                return true
            end
        end
    end
    return false
end
local function newRoofConfirmed(plot,origin,u,before)
    local point=roofCenter(origin,u)
    for _,m in ipairs(realRoofs(plot)) do
        if not before[m] then
            local ok,cf=pcall(function() return m:GetPivot() end)
            if ok then
                local p=cf.Position
                if Vector2.new(p.X-point.X,p.Z-point.Z).Magnitude<math.max(7,u.sx*.2)
                    and math.abs(p.Y-origin.Position.Y-(u.lv+1)*15)<26 then
                    return true
                end
            end
        end
    end
    return false
end
-- A flat structural cap is a fallback when the game's pitched-roof
-- event is not accepted. It uses PlaceFloor, the same event already used
-- for working upper-floor decks, and never pretends to be a sloped roof.
local function roofCapUnits(plot,origin)
    local result={}
    local h=15
    pcall(function()
        local cfg=require(game:GetService("ReplicatedStorage").Modules.PlotConfig)
        if type(cfg.StoreyHeight)=="number" then h=cfg.StoreyHeight end
    end)
    h=math.clamp(h,6,30)
    for _,roof in ipairs(plannedRoofs(plot,origin)) do
        if roofSupported(plot,origin,roof) and
            not roofAt(plot,origin,roof) then
            local nx,nz=math.ceil(roof.sx/28),math.ceil(roof.sz/28)
            for ix=1,nx do
                for iz=1,nz do
                    local sx,sz=roof.sx/nx,roof.sz/nz
                    local x=roof.x+(ix-(nx+1)/2)*sx
                    local z=roof.z+(iz-(nz+1)/2)*sz
                    local cf=origin*CFrame.new(x,(roof.lv+1)*h-.25,z)
                    result[#result+1]={
                        kind="Floor",cf=cf,sx=sx,sz=sz,
                        lv=roof.lv,color=roof.color,
                        material=roof.material,roofCap=true
                    }
                end
            end
        end
    end
    return result
end
local function addFlatRoofCap()
    if build.busy then notify("Construction already running");return end
    if not eventFor("Floor") then
        notify("PlaceFloor missing; no fallback available")
        return
    end
    local plot=ownedPlot()
    local origin=plot and plotFrame(plot)
    if not origin then notify("Owned plot unavailable");return end
    beginPreview()
    local caps=roofCapUnits(plot,origin)
    if #caps==0 then
        notify("No supported unroofed wall enclosure found for a flat cap.")
        return
    end
    build.busy=true
    build.cancel=false
    build.status="Testing a structural roof-cap slab..."
    refreshBuildStatus()
    task.spawn(function()
        local accepted,unconfirmed,skipped,consecutive=0,0,0,0
        local maxAttempts=math.min(#caps,24)
        -- The first slab must be server-confirmed; otherwise no bulk cap.
        for i=1,maxAttempts do
            if not alive or build.cancel or consecutive>=2 then break end
            local u=caps[i]
            local existing=occupiedFromPlot(plot,origin)
            do
                local present=false
                for _,v in ipairs(existing) do
                    if surfaceOverlaps(u,v) then present=true;break end
                end
                if present then
                    skipped=skipped+1
                else
                    local ok,err=pcall(function() fireUnit(u) end)
                    local confirmed=false
                    if ok then
                        for retry=1,16 do
                            if not alive or build.cancel then break end
                            task.wait(.18)
                            for _,v in ipairs(occupiedFromPlot(plot,origin)) do
                                if surfaceOverlaps(u,v) then
                                    confirmed=true;break
                                end
                            end
                            if confirmed then break end
                        end
                    end
                    if confirmed then
                        accepted=accepted+1
                        consecutive=0
                    else
                        unconfirmed=unconfirmed+1
                        consecutive=consecutive+1
                        if not ok then
                            notify("Roof cap error: "..tostring(err):sub(1,75))
                        end
                    end
                end
            end
            build.status="Roof cap: "..accepted.." confirmed / "..
                unconfirmed.." unconfirmed / "..skipped.." already filled"
            refreshBuildStatus()
            task.wait(.25)
        end
        build.busy=false
        build.lastAudit="FLAT ROOF-CAP AUDIT\n"..
            "Confirmed floor slabs: "..accepted..
            "\nUnconfirmed: "..unconfirmed..
            "\nExisting coverage: "..skipped..
            "\nPlanned slabs: "..#caps..
            "\nThis is a FLAT FLOOR CAP, not a native pitched roof."..
            "\nDo not add it if you want the roof area left open."
        build.status="Roof-cap test: "..accepted.." confirmed / "..
            unconfirmed.." unconfirmed; "..skipped.." already filled"
        refreshBuildStatus()
        notify(build.status)
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end

local function adoptExistingNativeRoofs(plot,origin)
    local count=0
    for _,u in ipairs(plannedRoofs(plot,origin)) do
        if roofAt(plot,origin,u) then count=count+1 end
    end
    if count>0 then
        roofTest.passed=true
        roofTest.signature=buildSignature(plot,origin)
        roofTest.status="Existing native roof models found: "..count
        return true
    end
    return false
end

local function testNativeRoof()
    if build.busy then notify("A build is already running");return end
    if not eventFor("Roof") then notify("PlaceRoof remote is missing");return end
    local plot=ownedPlot()
    local origin=plot and plotFrame(plot)
    if not origin then notify("Owned plot required for roof test");return end
    beginPreview()
    if adoptExistingNativeRoofs(plot,origin) then
        notify("Existing roof confirmed; use ADD REAL ROOFS for missing sections.")
        if alive and state.page=="Builder" then switchPage("Builder") end
        return
    end
    local chosen
    for _,u in ipairs(plannedRoofs(plot,origin)) do
        if roofSupported(plot,origin,u) and not roofAt(plot,origin,u) then
            chosen=u;break
        end
    end
    if not chosen then
        build.lastAudit="NATIVE ROOF DIAGNOSTIC\n"..
            "No unroofed planned area has at least two detectable supporting wall models.\n"..
            "The actual roof remote signature has not been verified.\n"..
            "Use the FLAT ROOF FALLBACK only if you accept a flat cap."
        notify("No verified roof supports identified. Open VIEW BUILD AUDIT.")
        return
    end
    local before={}
    for _,m in ipairs(realRoofs(plot)) do before[m]=true end
    build.busy=true;build.cancel=false
    build.status="Testing ONE native "..chosen.style.." roof..."
    refreshBuildStatus()
    task.spawn(function()
        local ok,err=pcall(function() fireUnit(chosen) end)
        local confirmed=false
        if ok then
            for i=1,24 do
                if not alive or build.cancel then break end
                if newRoofConfirmed(plot,origin,chosen,before) then
                    confirmed=true;break
                end
                task.wait(.25)
            end
        end
        local roofCount=0
        for _,model in ipairs(realRoofs(plot)) do roofCount=roofCount+1 end
        build.lastAudit="NATIVE ROOF DIAGNOSTIC\n"..
            "Style: "..chosen.style..
            "\nFloor index: "..tostring(chosen.lv)..
            "\nX/Z: "..math.floor(chosen.x+.5).."/"..math.floor(chosen.z+.5)..
            "\nWidth/depth: "..math.floor(chosen.sx+.5)..
                "/"..math.floor(chosen.sz+.5)..
            "\nFireServer executed: "..tostring(ok)..
            "\nNew real roof confirmed: "..tostring(confirmed)..
            "\nReal roof objects now detected: "..roofCount..
            "\nLocal call error: "..tostring(err or "none")..
            "\nA successful FireServer is not server acceptance."..
            "\nIf still unconfirmed, preserve your plot and share this audit."
        roofTest.passed=confirmed
        roofTest.signature=confirmed and buildSignature(plot,origin) or nil
        roofTest.status=confirmed and "Native pitched roof CONFIRMED" or
            "Roof not confirmed. No more roof requests will be sent."
        build.busy=false
        build.status=roofTest.status
        refreshBuildStatus()
        notify(roofTest.status..
            (not ok and (": "..tostring(err):sub(1,75)) or ""))
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end
local function addVerifiedRoofs()
    if build.busy then notify("A build is already running");return end
    local plot=ownedPlot()
    local origin=plot and plotFrame(plot)
    if not origin then notify("Owned plot required");return end
    if not roofTest.passed or roofTest.signature~=buildSignature(plot,origin) then
        if not adoptExistingNativeRoofs(plot,origin) then
            notify("TEST ONE ROOF must succeed before adding native pitched roofs.")
            return
        end
    end
    local roofs=plannedRoofs(plot,origin)
    build.busy=true;build.cancel=false
    task.spawn(function()
        local added,missing,occupied=0,0,0
        for _,u in ipairs(roofs) do
            if not alive or build.cancel or added>=6 or missing>=2 then break end
            if roofAt(plot,origin,u) then
                occupied=occupied+1
            elseif roofSupported(plot,origin,u) then
                local before={}
                for _,m in ipairs(realRoofs(plot)) do before[m]=true end
                local ok,err=pcall(function() fireUnit(u) end)
                local confirmed=false
                if ok then
                    for i=1,20 do
                        if not alive or build.cancel then break end
                        if newRoofConfirmed(plot,origin,u,before) then
                            confirmed=true;break
                        end
                        task.wait(.25)
                    end
                end
                if confirmed then
                    added=added+1
                    missing=0
                else
                    missing=missing+1
                    if not ok then notify("Roof test error: "..tostring(err):sub(1,75)) end
                end
                build.status="Roofs: "..added.." confirmed / "..occupied..
                    " existing / "..missing.." consecutive failures"
                refreshBuildStatus()
            end
        end
        build.busy=false
        build.status=build.cancel and "Roof installation stopped" or
            ("Roofs: "..added.." confirmed, "..occupied..
            " already present, "..missing.." consecutive unconfirmed")
        refreshBuildStatus()
        notify(build.status)
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end

-- The plot is the source of truth. A new script revision must never
-- assume that an old castle vanished or fill newly designed walls over it.
local function newShellCanAttach(u,physical)
    local existingWalls=0
    for _,v in ipairs(physical) do
        if v.kind=="Wall" then existingWalls=existingWalls+1 end
    end
    if existingWalls<4 then return true end
    if u.kind=="Floor" then
        -- Do not populate an unrelated, new building footprint. A new floor
        -- must have nearby existing masonry on this storey or the one below.
        for _,v in ipairs(physical) do
            if v.kind=="Wall" and (v.lv==u.lv or v.lv==u.lv-1) then
                local mid=(v.a+v.b)*.5
                local c=u.cf.Position
                if Vector2.new(mid.X-c.X,mid.Z-c.Z).Magnitude<
                    math.max(u.sx,u.sz)*.68+5 then
                    return true
                end
            end
        end
        return false
    elseif u.kind=="Wall" then
        for _,v in ipairs(physical) do
            if v.kind=="Wall" and v.lv==u.lv then
                local function close(p,q)
                    return Vector2.new(p.X-q.X,p.Z-q.Z).Magnitude<3.2
                end
                -- Only extend an existing wall at its end or fill its
                -- matching segment. A moved blueprint cannot redraw wings.
                if close(u.a,v.a) or close(u.a,v.b) or
                    close(u.b,v.a) or close(u.b,v.b) then return true end
            end
        end
        return false
    end
    return false
end
local function shellConfirmed(u,physical)
    if u.kind=="Wall" then
        local remaining=openWallSegments(u,physical)
        if #remaining==0 then return true end
        local requested=(u.b-u.a).Magnitude
        local still=0
        for _,part in ipairs(remaining) do
            still=still+(part.b-part.a).Magnitude
        end
        return requested>0 and still/requested<.12
    end
    if u.kind=="Floor" then
        for _,v in ipairs(physical) do
            if surfaceOverlaps(u,v) then return true end
        end
    end
    return false
end
local function startBuild()
    if build.busy then notify("A build is already running");return end
    if not ensureCatalog() or not stairCatalog.wall then
        notify("Could not identify a solid wall style from the catalog.")
        return
    end
    -- Rebuild the same authored geometry, then intersect it with the actual
    -- physical plot. Never destroy user-created parts or existing wings.
    beginPreview()
    local units,plot,origin,stats=buildPlan()
    if not units or not plot or not origin then
        notify("Your owned plot isn't available.")
        return
    end
    local baseline=occupiedFromPlot(plot,origin)
    local wallsPresent,floorsPresent=0,0
    local chosenWallId=nil
    local structures=plot:FindFirstChild("Structures")
    if structures then
        for _,model in ipairs(structures:GetChildren()) do
            if model:IsA("Model") and
                typeof(model:GetAttribute("WallCFrame"))=="CFrame" and
                not isGlassModel(model) then
                chosenWallId=chosenWallId or model:GetAttribute("ItemId")
            end
        end
    end
    for _,u in ipairs(baseline) do
        if u.kind=="Wall" then wallsPresent=wallsPresent+1
        elseif u.kind=="Floor" then floorsPresent=floorsPresent+1 end
    end
    if wallsPresent>=4 then
        -- Reuse the actual wall style of the existing castle when it is a
        -- catalogued structural wall. Different style IDs can collide.
        local row=chosenWallId and
            buildCatalog.byId["Walls|"..tostring(chosenWallId)]
        if row and scoreWall(row.name)>=0 then
            stairCatalog.wall={id=row.id,name=row.name,category="Walls"}
        end
        build.passed=true
        build.signature=buildSignature(plot,origin)
    elseif not build.passed or build.signature~=buildSignature(plot,origin) then
        notify("Empty plot: TEST ONE WALL under Advanced Tools first.")
        return
    end
    local requests,protected,already= {},0,0
    for _,u in ipairs(units) do
        if u.kind=="Wall" or u.kind=="Floor" then
            if shellConfirmed(u,baseline) then
                already=already+1
            elseif newShellCanAttach(u,baseline) then
                requests[#requests+1]=u
            else
                protected=protected+1
            end
        end
    end
    if #requests==0 then
        build.lastAudit="CURRENT PLOT SNAPSHOT\nExisting walls: "..wallsPresent..
            "\nExisting floors: "..floorsPresent..
            "\nMatching blueprint pieces: "..already..
            "\nExcluded to protect older layout: "..protected..
            "\nNo missing structural pieces match the current repair plan."..
            "\nThis check does not cover roofs, doors, stairs or Shape details."
        build.status="Current shell checked; no safe missing pieces identified."
        refreshBuildStatus()
        notify(build.status)
        return
    end
    if not eventFor("Wall") or not eventFor("Floor") then
        notify("Structural PlaceWall or PlaceFloor event unavailable")
        return
    end
    -- Small confirmed batches: a server rejection is not an occupied wall.
    -- Re-run this action to continue once the accepted pieces replicate.
    local maxAttempt=math.min(#requests,65)
    build.busy=true
    build.cancel=false
    build.total=maxAttempt
    build.sent=0
    build.status="Repairing current plot: 0 / "..maxAttempt
    refreshBuildStatus()
    task.spawn(function()
        local accepted,unconfirmed,skipped,attempted=0,0,0,0
        local consecutive=0
        local samples={}
        for i=1,maxAttempt do
            if not alive or build.cancel or consecutive>=3 then break end
            local u=requests[i]
            local physical=occupiedFromPlot(plot,origin)
            if shellConfirmed(u,physical) then
                skipped=skipped+1
            elseif not newShellCanAttach(u,baseline) then
                skipped=skipped+1
            else
                local ok,err=pcall(function() fireUnit(u) end)
                attempted=attempted+1
                build.sent=attempted
                local confirmed=false
                if ok then
                    for k=1,12 do
                        if not alive or build.cancel then break end
                        task.wait(.20)
                        if shellConfirmed(u,occupiedFromPlot(plot,origin)) then
                            confirmed=true;break
                        end
                    end
                end
                if confirmed then
                    accepted=accepted+1
                    consecutive=0
                else
                    unconfirmed=unconfirmed+1
                    consecutive=consecutive+1
                    local center=u.kind=="Wall" and (u.a+u.b)*.5
                        or u.cf.Position
                    if #samples<12 then
                        samples[#samples+1]=u.kind.." floor "..(u.lv+1)..
                            " ("..math.floor(center.X+.5)..","..
                            math.floor(center.Y+.5)..","..
                            math.floor(center.Z+.5)..")"..
                            (not ok and (" / "..tostring(err):sub(1,60)) or
                            " / no server-confirmed piece")
                    end
                end
            end
            build.status="Current plot: "..accepted.." confirmed / "..
                unconfirmed.." unconfirmed / "..skipped.." already placed"
            refreshBuildStatus()
            task.wait(.12)
        end
        build.busy=false
        build.lastAudit="CURRENT PLOT REPAIR AUDIT\n"..
            "Pre-existing walls: "..wallsPresent..
            "\nPre-existing floors: "..floorsPresent..
            "\nMissing candidates: "..#requests..
            "\nProtected because layout differs: "..protected..
            "\nAlready matched: "..already..
            "\nNewly confirmed: "..accepted..
            "\nSent but unconfirmed: "..unconfirmed..
            "\nSkipped after live recheck: "..skipped..
            "\nNot attempted: "..math.max(0,#requests-attempted-skipped)..
            "\n\nUnconfirmed is NOT proof of a server error. "..
            "Further requests stop after 3 consecutive unconfirmed placements."..
            (#samples>0 and ("\n\nSAMPLE MISSING LOCATIONS\n"..
                table.concat(samples,"\n")) or "")
        if consecutive>=3 then
            build.status="Stopped after 3 unconfirmed structures; inspect audit."
        elseif build.cancel then
            build.status="Structure repair stopped."
        else
            build.status="Structure repair: "..accepted.." confirmed / "..
                unconfirmed.." unconfirmed. Continue later if pieces remain."
        end
        refreshBuildStatus()
        notify(build.status)
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end

-- The server-replicated plot is the layout snapshot. Nothing is
-- deleted or redrawn when a script update changes the design concept.
local function inspectCurrentPlot()
    if build.busy then notify("Finish the active build job first");return end
    local plot=ownedPlot()
    local origin=plot and plotFrame(plot)
    if not origin then notify("Owned plot not found");return end
    beginPreview()
    local occupied=occupiedFromPlot(plot,origin)
    local units,_,_,stats=buildPlan()
    local existing={Wall=0,Floor=0,Roof=0}
    for _,v in ipairs(occupied) do
        if existing[v.kind]~=nil then
            existing[v.kind]=existing[v.kind]+1
        end
    end
    local missing={Wall=0,Floor=0,Roof=0}
    local protected=0
    if units then
        for _,u in ipairs(units) do
            if u.kind=="Wall" or u.kind=="Floor" then
                if not shellConfirmed(u,occupied) then
                    if newShellCanAttach(u,occupied) then
                        missing[u.kind]=missing[u.kind]+1
                    else
                        protected=protected+1
                    end
                end
            end
        end
    end
    local w,d=getFootprint(plot)
    build.lastAudit="LIVE PLOT SNAPSHOT (READ ONLY)\n"..
        "Plot: "..plot.Name..
        "\nUsable footprint: "..math.floor(w+.5).." x "..math.floor(d+.5)..
        "\nReal walls: "..existing.Wall..
        "\nReal floors: "..existing.Floor..
        "\nReal roofs: "..existing.Roof..
        "\nShape-like instances: "..#shapeModels(plot)..
        "\nMissing wall segments near existing layout: "..missing.Wall..
        "\nMissing interior floor tiles: "..missing.Floor..
        "\nUnrelated/new layout pieces held back: "..protected..
        "\n\nWindows/doors are separate native items."..
        "\nPreview geometry is NOT a saved original blueprint."..
        "\nLayout is reconstructed from the actual plot on every run."
    build.status="Plot scanned: "..existing.Wall.." walls, "..
        existing.Floor.." floors; "..(missing.Wall+missing.Floor)..
        " candidate repairs."
    refreshBuildStatus()
    modal("CURRENT PLOT • READ ONLY",build.lastAudit)
end

-- A truthful, request-derived preview. Concept-only embellishments fade away;
-- walls/floors and VERIFIED Stair/Detail Shapes appear where their placement
-- requests would actually go, after the plot's current occupancy is scanned.
local function showBuildablePreview()
    -- Always rebuild the authored geometry before deriving placement units.
    -- Otherwise a previously displayed plan could hide stale design parts.
    beginPreview()
    local units,plot,origin,stats=buildPlan()
    if not units or not plot or not origin then
        notify("Owned plot required to preview the actual build plan")
        return
    end
    -- This is the actual masonry request plan, not the decorative concept.
    -- Stair and roof repairs are separate verified actions, so don't
    -- imply this view is a preview of those independent operations.
    local noRoof={}
    for _,u in ipairs(units) do
        if u.kind~="Roof" then noRoof[#noRoof+1]=u end
    end
    units=noRoof
    local previewShapes=false
    -- A visual Shape in the concept is not necessarily an accepted
    -- server placement. Do not show optimistic stairs/decor in an
    -- "actual build" overlay unless that separate feature is requested.
    -- Replace an older request preview without erasing the source layout.
    local existing=previewFolder:FindFirstChild("ActualPlacementPlan")
    if existing then existing:Destroy() end
    local folder=Instance.new("Folder")
    folder.Name="ActualPlacementPlan"
    folder.Parent=previewFolder
    local plannedCount={Wall=0,Floor=0,Roof=0,StairShape=0,DetailShape=0}
    local maxShow=math.min(#units,1200)
    local h=15
    pcall(function()
        local cfg=require(game:GetService("ReplicatedStorage").Modules.PlotConfig)
        if type(cfg.StoreyHeight)=="number" then h=cfg.StoreyHeight end
    end)
    local function put(u)
        local part=Instance.new("Part")
        part.Anchored=true
        part.CanCollide=false;part.CanQuery=false;part.CanTouch=false
        part.CastShadow=false
        part.Name="INTENDED "..u.kind
        local kind=u.kind
        if kind=="Wall" then
            local diff=u.b-u.a
            local length=Vector3.new(diff.X,0,diff.Z).Magnitude
            part.Size=Vector3.new(length,h,.7)
            part.CFrame=CFrame.new((u.a+u.b)*.5+Vector3.new(0,h*.5,0))*
                CFrame.Angles(0,math.atan2(-diff.Z,diff.X),0)
        elseif kind=="Floor" then
            part.Size=Vector3.new(u.sx,.55,u.sz)
            part.CFrame=u.cf
        elseif kind=="Roof" then
            part.Size=Vector3.new(u.sx,.6,u.sz)
            part.CFrame=origin*CFrame.new(u.x,(u.lv+1)*h,u.z)
        elseif kind=="StairShape" or kind=="DetailShape" then
            part.Size=u.size
            part.CFrame=u.cf
        else
            part:Destroy()
            return
        end
        local colors={
            Wall=Color3.fromRGB(196,194,180),
            Floor=Color3.fromRGB(129,198,227),
            Roof=Color3.fromRGB(148,113,190),
            StairShape=Color3.fromRGB(73,224,164),
            DetailShape=Color3.fromRGB(234,188,88)
        }
        part.Color=u.color or colors[kind] or Color3.fromRGB(214,214,214)
        part.Material=Enum.Material.SmoothPlastic
        part.Transparency=.14
        part.Parent=folder
        plannedCount[kind]=plannedCount[kind]+1
    end
    -- Concepts are not hidden from the geometry authoring functions, only
    -- from the player's screen: buildPlan() still sees their source parts.
    for _,child in ipairs(previewFolder:GetChildren()) do
        if child:IsA("BasePart") then
            child.Transparency=1
            for _,desc in ipairs(child:GetChildren()) do
                if desc:IsA("SelectionBox") then desc.Transparency=1 end
            end
        end
    end
    for i=1,maxShow do
        put(units[i])
        if i%70==0 then task.wait() end
    end
    local hidden=math.max(0,#units-maxShow)
    notify("PLACEABLE VIEW: "..plannedCount.Wall.." walls / "..
        plannedCount.Floor.." floor units / "..plannedCount.StairShape..
        " stair Shapes / "..plannedCount.DetailShape.." details"..
        " / roofs, windows, doors and Shapes are separate confirmed stages"..
        (hidden>0 and (" / "..hidden.." units beyond preview cap") or "")..
        ". These are requests, not confirmed game placements.")
end

-- Restore an already-built glass-looking wall only after one MaterialItem
-- request visibly changes it; never assume a remote call succeeded.
local wallRepair={passed=false,material=nil,status="Material repair not tested"}
local function glassWalls(plot)
    local out={}
    local folder=plot:FindFirstChild("Structures")
    if folder then
        for _,model in ipairs(folder:GetChildren()) do
            if model:IsA("Model") and model:GetAttribute("WallLength")
                and model:GetAttribute("GUID")~=nil and isGlassModel(model) then
                out[#out+1]=model
            end
        end
    end
    return out
end
local function materialRemote()
    local events=game:GetService("ReplicatedStorage"):FindFirstChild("Events")
    local plotEvents=events and events:FindFirstChild("Plot")
    local r=plotEvents and plotEvents:FindFirstChild("MaterialItem")
    return r and r:IsA("RemoteEvent") and r or nil
end
local function materialTest()
    if build.busy then notify("A construction job is still running");return end
    local plot=ownedPlot()
    if not plot then notify("Owned plot not detected");return end
    local walls=glassWalls(plot)
    if #walls==0 then notify("No eligible glass walls with GUIDs found");return end
    local remote=materialRemote()
    if not remote then notify("MaterialItem event unavailable");return end
    local target=walls[1]
    local profile=DESIGN_STYLES[state.design] or DESIGN_STYLES[1]
    local desired=Enum.Material[profile.wall]
    if not desired then notify("Selected wall material is unsupported");return end
    build.busy=true;build.cancel=false
    build.status="Testing "..profile.wall.." on one glass wall"
    refreshBuildStatus()
    task.spawn(function()
        local ok,err=pcall(function()
            remote:FireServer(tostring(target:GetAttribute("GUID")),profile.wall)
        end)
        local confirmed=false
        if ok then
            for i=1,25 do
                if build.cancel or not alive then break end
                if target.Parent and not isGlassModel(target) then
                    local changed=0;local count=0
                    for _,p in ipairs(target:GetDescendants()) do
                        if p:IsA("BasePart") then
                            count=count+1
                            if p.Material==desired then changed=changed+1 end
                        end
                    end
                    if count>0 and changed/count>.50 then confirmed=true;break end
                end
                task.wait(.18)
            end
        end
        wallRepair.passed=confirmed
        wallRepair.material=confirmed and profile.wall or nil
        wallRepair.status=confirmed and ("Glass wall fixed: "..profile.wall)
            or "Glass wall did not change; no bulk repair permitted"
        build.busy=false
        build.status=wallRepair.status
        refreshBuildStatus()
        notify(wallRepair.status..(ok and "" or (" / "..tostring(err))))
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end
local function repairGlassWalls()
    if build.busy then notify("A job is running");return end
    local plot=ownedPlot()
    local profile=DESIGN_STYLES[state.design] or DESIGN_STYLES[1]
    local remote=materialRemote()
    if not plot or not remote or not wallRepair.passed
        or wallRepair.material~=profile.wall then
        notify("Test the existing wall material first")
        return
    end
    local walls=glassWalls(plot)
    build.busy=true;build.cancel=false
    build.status="Reworking remaining glass walls..."
    refreshBuildStatus()
    task.spawn(function()
        local changed=0
        for _,wall in ipairs(walls) do
            if not alive or build.cancel or changed>=320 then break end
            local ok=pcall(function()
                remote:FireServer(tostring(wall:GetAttribute("GUID")),profile.wall)
            end)
            if not ok then build.status="Repair interrupted";break end
            changed=changed+1
            if changed%12==0 then
                build.status="Material requests: "..changed
                refreshBuildStatus()
            end
            task.wait(.12)
        end
        build.busy=false
        if build.cancel then build.status="Material repair cancelled"
        elseif build.status~="Repair interrupted" then
            build.status="Sent "..changed.." material updates; inspect finished walls"
        end
        refreshBuildStatus()
        notify(build.status)
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end

local function stopBuild()
    if build.busy then
        build.cancel=true
        build.status="Stopping after current request..."
        refreshBuildStatus()
        notify("Stopping remaining build requests")
    else notify("No build is running") end
end

local function pageView()
    for _, child in ipairs(content:GetChildren()) do child:Destroy() end
    local scroll = ui("ScrollingFrame", {
        BackgroundTransparency = 1, BorderSizePixel = 0,
        Size = UDim2.new(1, 0, 1, 0), CanvasSize = UDim2.fromOffset(0,0),
        AutomaticCanvasSize = Enum.AutomaticSize.Y,
        ScrollBarThickness = 4, ScrollBarImageColor3 = C.purpleDark,
        ScrollingDirection = Enum.ScrollingDirection.Y,
    }, content)
    ui("UIPadding", {
        PaddingLeft = UDim.new(0,19), PaddingRight = UDim.new(0,19),
        PaddingTop = UDim.new(0,17), PaddingBottom = UDim.new(0,18)
    }, scroll)
    ui("UIListLayout", {
        FillDirection = Enum.FillDirection.Vertical, SortOrder = Enum.SortOrder.LayoutOrder,
        Padding = UDim.new(0,11)
    }, scroll)
    return scroll
end
local function block(scroll, h, bg)
    local p = corner(ui("Frame",{
        Size = UDim2.new(1,0,0,h),
        BackgroundColor3 = bg or C.panel, BorderSizePixel = 0,
    }, scroll), 12)
    border(p,C.line,1,0.25)
    return p
end
local function pageHead(scroll, title, summary)
    local h = ui("Frame", {BackgroundTransparency=1,Size=UDim2.new(1,0,0,56)}, scroll)
    text(h,title,0,0,400,33,22,C.white,true,{Size=UDim2.new(1,0,0,33)})
    text(h,summary,0,33,440,18,11,C.dim,false,{Size=UDim2.new(1,0,0,18)})
end
local function pill(parent, value, x, y, w, color)
    local f = corner(ui("Frame", {
        BackgroundColor3 = C.raised2, BorderSizePixel = 0,
        Position = UDim2.fromOffset(x,y), Size = UDim2.fromOffset(w,22)
    },parent),11)
    text(f,value,0,0,w,22,10,color or C.purple,true,{TextXAlignment=Enum.TextXAlignment.Center})
end
local function sectionNote(parent, title, description, y)
    text(parent,title,17,y,460,25,15,C.white,true,{Size=UDim2.new(1,-34,0,25)})
    text(parent,description,17,y+27,460,42,12,C.dim,false,{
        Size=UDim2.new(1,-34,0,42), TextWrapped=true,TextYAlignment=Enum.TextYAlignment.Top,
        TextTruncate=Enum.TextTruncate.None,
    })
end

local overlay = ui("Frame",{
    Name="DialogOverlay", BackgroundColor3=Color3.new(0,0,0),
    BackgroundTransparency=0.35, BorderSizePixel=0, Visible=false,
    Size=UDim2.fromScale(1,1), ZIndex=25,
},win)
local dialog=corner(ui("Frame",{
    AnchorPoint=Vector2.new(.5,.5),Position=UDim2.fromScale(.5,.5),
    Size=UDim2.new(1,-90,0,315), BackgroundColor3=C.raised,
    BorderSizePixel=0,ZIndex=26
},overlay),14)
border(dialog,C.purple,1.5,0.1)
local dialogTitle=text(dialog,"",22,19,420,32,20,C.white,true,{ZIndex=27,Size=UDim2.new(1,-44,0,32)})
local dialogBody=text(dialog,"",22,59,410,108,13,C.dim,false,{
    ZIndex=27,TextWrapped=true,TextYAlignment=Enum.TextYAlignment.Top,
    TextTruncate=Enum.TextTruncate.None, Size=UDim2.new(1,-44,0,170)
})
local dialogAction=nil
local dialogClose
dialogClose=button(dialog,"GOT IT",22,190,155,34,true,function()
    overlay.Visible=false
    local fn=dialogAction
    dialogAction=nil
    dialogClose.Text="GOT IT"
    if fn then fn() end
end)
dialogClose.ZIndex=27
dialogClose.Position=UDim2.new(.05,0,0,267)
dialogClose.Size=UDim2.new(.42,0,0,34)
local cancelDialog=button(dialog,"CANCEL",0,190,95,34,false,function()
    dialogAction=nil
    overlay.Visible=false
end)
cancelDialog.ZIndex=27
cancelDialog.Position=UDim2.new(.53,0,0,267)
cancelDialog.Size=UDim2.new(.42,0,0,34)
modal = function(title,body,confirmText,callback)
    dialogTitle.Text=title
    dialogBody.Text=body
    dialogAction=callback
    dialogClose.Text=confirmText or "GOT IT"
    overlay.Visible=true
end

local function updateSidebar()
    local compactNav=win.AbsoluteSize.Y<460
    for i,nav in ipairs(navSpecs) do
        local item=navButtons[nav[1]]
        if item then
            item.button.Position=UDim2.fromOffset(9,compactNav and (37+(i-1)*39) or (48+(i-1)*47))
            item.button.Size=UDim2.new(1,-18,0,compactNav and 35 or 41)
        end
    end
    local sidebarW = (state.compact or win.AbsoluteSize.X < 620) and 116 or 185
    sidebar.Size = UDim2.new(0,sidebarW,1,-102)
    content.Position = UDim2.fromOffset(sidebarW,69)
    content.Size = UDim2.new(1,-sidebarW,1,-105)
    headerStatus.Visible = win.AbsoluteSize.X > 760
    for _, item in pairs(navButtons) do
        item.label.TextSize = sidebarW <= 116 and 10 or 12
        item.label.Position = UDim2.fromOffset(sidebarW <= 116 and 35 or 42,0)
    end
    sidebarBottom.Visible = sidebarW > 130
end

switchPage = function(page)
    state.page = page
    if (page=="Builder" or page=="Catalog") and not stairCatalog.scanned and not stairCatalog.scanning then
        task.spawn(function()
            scanStairs()
            if alive and (state.page=="Builder" or state.page=="Catalog") then
                switchPage(state.page)
            end
        end)
    end
    for name, entry in pairs(navButtons) do
        local selected = page == name
        entry.button.BackgroundColor3 = selected and C.purpleDark or C.panel
        entry.label.TextColor3 = selected and C.white or C.dim
    end
    renderPage(page)
end

local function showcaseCard(scroll, d, index)
    local p=block(scroll,128)
    local stripe=corner(ui("Frame",{
        BackgroundColor3=index==1 and C.purple or C.purpleDark,
        Position=UDim2.fromOffset(0,0),Size=UDim2.fromOffset(4,128),BorderSizePixel=0
    },p),2)
    text(p,d.name,16,11,420,28,17,C.white,true,{Size=UDim2.new(1,-32,0,28)})
    text(p,d.subtitle,16,43,440,28,12,C.dim,false,{Size=UDim2.new(1,-32,0,28),TextWrapped=true})
    pill(p,d.category,16,80,87,C.purple)
    pill(p,tostring(d.floors).." STOREYS",111,80,91,C.mint)
    local selected = state.design == index
    local btn=button(p,selected and "SELECTED ✓" or "SELECT",16,105,108,20,selected,function()
        state.design=index
        if previewFolder then beginPreview() end
        notify(d.name.." selected as active blueprint")
        switchPage("Blueprints")
    end)
    btn.TextSize=10
    local preview=button(p,"DETAILS",133,105,95,20,false,function()
        modal(d.name,
            d.subtitle.."\n\n"..tostring(d.floors).." storeys  •  "..d.category..
            "\n\nConcept blueprint only. 3D model placement, import/export and build automation are planned for a later version.")
    end)
    preview.TextSize=10
    return p
end

renderPage = function(page)
    if not alive then return end
    local scroll=pageView()
    if page=="Overview" then
        pageHead(scroll,"Your building workspace","Plan incredible builds. Deploy later.")
        local hero=block(scroll,173,C.raised)
        ui("UIGradient",{
            Color=ColorSequence.new(C.raised,Color3.fromRGB(57,39,89)),
            Rotation=0
        },hero)
        pill(hero,"●  EARLY ACCESS PROTOTYPE",17,14,201,C.mint)
        text(hero,"Build something legendary.",17,45,460,32,20,C.white,true,{
            Size=UDim2.new(1,-34,0,32),TextScaled=false
        })
        text(hero,"Choose a blueprint, preview its outline, then test placement in Builder.",17,82,480,38,12,C.dim,false,{
            Size=UDim2.new(1,-34,0,38),TextWrapped=true
        })
        button(hero,"EXPLORE BLUEPRINTS",17,128,192,32,true,function() switchPage("Blueprints") end)
        button(hero,"BROWSE ITEMS",216,128,137,32,false,function() switchPage("Catalog") end)

        local metrics=block(scroll,83)
        local values={{"31","MATERIALS"},{"5","STOREYS PLANNED"},
            {buildCatalog.scanned and tostring(buildCatalog.total) or "...","BUILD ITEMS"}}
        for i,m in ipairs(values) do
            local x=(i-1)/3
            local cell=ui("Frame",{
                BackgroundTransparency=1, Position=UDim2.new(x,0,0,0),
                Size=UDim2.new(1/3,0,1,0)
            },metrics)
            text(cell,m[1],0,8,140,40,25,i==1 and C.purple or C.white,true,{
                Size=UDim2.new(1,0,0,40),TextXAlignment=Enum.TextXAlignment.Center
            })
            text(cell,m[2],0,49,140,18,10,C.dim,true,{
                Size=UDim2.new(1,0,0,18),TextXAlignment=Enum.TextXAlignment.Center
            })
            if i<3 then ui("Frame",{
                BackgroundColor3=C.line,BorderSizePixel=0,
                Position=UDim2.new(1,-1,0.2,0),Size=UDim2.new(0,1,0.6,0)
            },cell) end
        end
        local d=designs[state.design]
        local selected=block(scroll,125)
        sectionNote(selected,"ACTIVE BLUEPRINT  /  "..d.name,
            d.subtitle..". Currently a layout concept; no physical model is stored yet.",11)
        button(selected,"PREVIEW DETAILS",17,87,146,27,false,function()
            modal(d.name,d.subtitle.."\n\nLibrary model support will be added after the placement engine is verified.")
        end)
        button(selected,"OPEN BUILDER",170,87,132,27,true,function() switchPage("Builder") end)
    elseif page=="Blueprints" then
        pageHead(scroll,"Blueprint library","Future home for shareable, ready-to-place creations.")
        local filters=ui("Frame",{BackgroundTransparency=1,Size=UDim2.new(1,0,0,35)},scroll)
        for i,filter in ipairs({"ALL","CASTLES","MODERN","UTILITY"}) do
            local b=corner(ui("TextButton",{
                Position=UDim2.new((i-1)*0.25,3,0,0),
                Size=UDim2.new(.25,-8,0,32),
                BackgroundColor3=state.filter==filter and C.purpleDark or C.raised,
                Text=filter,Font=Enum.Font.GothamBold,TextSize=10,
                TextColor3=state.filter==filter and C.white or C.dim,
                BorderSizePixel=0
            },filters),8)
            on(b.MouseButton1Click,function()
                state.filter=filter
                switchPage("Blueprints")
            end)
        end
        for i,d in ipairs(designs) do
            if state.filter=="ALL" or state.filter==d.category then showcaseCard(scroll,d,i) end
        end
        local tip=block(scroll,76)
        sectionNote(tip,"COMMUNITY BLUEPRINTS — COMING SOON",
            "Import, save, browse and share builds with other players once the format is ready.",8)
    elseif page=="Builder" then
        pageHead(scroll,"Construction desk","Customize your project before you build.")
        local d=designs[state.design]
        local selected=block(scroll,107,C.raised)
        pill(selected,"CURRENT DESIGN",16,12,130,C.mint)
        text(selected,d.name,16,44,430,30,20,C.white,true,{Size=UDim2.new(1,-34,0,30)})
        button(selected,"CHANGE",16,79,102,23,false,function() switchPage("Blueprints") end)
        button(selected,"BUILD CATALOG",126,79,150,23,false,function() switchPage("Catalog") end)
        button(selected,"GO TO CENTER",284,79,157,23,false,teleportPlotCenter)

        local opts=block(scroll,165)
        text(opts,"BUILD SETTINGS",16,13,350,27,15,C.white,true)
        text(opts,"Planned storeys",16,55,260,24,13,C.dim,false)
        local minusF=button(opts,"−",16,85,37,34,false,function()
            state.floors=math.max(1,state.floors-1)
            if previewFolder then beginPreview() end
            switchPage("Builder")
        end)
        minusF.TextSize=20
        text(opts,tostring(state.floors),63,85,43,34,19,C.white,true,{
            TextXAlignment=Enum.TextXAlignment.Center
        })
        local plusF=button(opts,"+",114,85,37,34,false,function()
            state.floors=math.min(5,state.floors+1)
            if previewFolder then beginPreview() end
            switchPage("Builder")
        end)
        plusF.TextSize=19
        text(opts,"MAX 5  •  STAIRS DO NOT BLOCK MASONRY",16,132,350,18,10,C.muted,true)

        local advancedControl=block(scroll,65,C.raised)
        text(advancedControl,"ESSENTIAL WORKFLOW",16,8,284,21,13,C.white,true)
        text(advancedControl,"Structure, repairs and a verified preview first.",16,31,300,20,10,C.dim,false)
        button(advancedControl,state.advancedBuilder and "HIDE ADVANCED" or "ADVANCED TOOLS",
            0,17,142,31,state.advancedBuilder,function()
                state.advancedBuilder=not state.advancedBuilder
                switchPage("Builder")
            end).Position=UDim2.new(1,-155,0,17)

        if state.advancedBuilder then
        local speedBox=block(scroll,120)
        text(speedBox,"CONSTRUCTION SPEED",16,10,400,25,15,C.white,true)
        local speedModes={"Steady","Fast","Turbo"}
        for i,mode in ipairs(speedModes) do
            local selected=state.buildSpeed==mode
            local b=button(speedBox,mode:upper(),0,42,100,31,selected,function()
                if build.busy then
                    notify("Finish or stop the current build before changing speed")
                    return
                end
                state.buildSpeed=mode
                notify("Build speed set to "..mode)
                switchPage("Builder")
            end)
            b.Position=UDim2.new((i-1)/3,6,0,42)
            b.Size=UDim2.new(1/3,-12,0,31)
        end
        text(speedBox,"Turbo: paced bursts with one missing-piece check. Still verify the actual result.",16,82,470,29,10,C.dim,false,{
            Size=UDim2.new(1,-32,0,29),TextWrapped=true
        })

        local styleName=DESIGN_STYLES[state.design] and DESIGN_STYLES[state.design].name or "Auto"
        local choice=block(scroll,138)
        sectionNote(choice,"AUTOMATIC DESIGN MATERIALS",
            state.autoStyle and ("ACTIVE: "..styleName.." / matching stone, timber, slate, glass and metal.")
                or ("MANUAL OVERRIDE: "..state.material.." / "..state.colorName),10)
        button(choice,state.autoStyle and "AUTO STYLE: ON" or "AUTO STYLE: OFF",16,83,162,31,state.autoStyle,function()
            state.autoStyle=not state.autoStyle
            if previewFolder then beginPreview() end
            switchPage("Builder")
        end)
        button(choice,"PALETTE DETAILS",185,83,145,31,false,function() switchPage("Materials") end)
        text(choice,"The studio chooses materials by architectural role, not one material for the whole castle.",
            16,116,442,18,10,C.dim,false,{Size=UDim2.new(1,-32,0,18)})

        end -- advanced construction speed + palette
        local action=block(scroll,177,C.raised)
        text(action,"DESIGN IDEA vs. REAL SHELL REQUESTS",16,10,410,24,15,C.mint,true)
        text(action,"Concept is an artistic mockup. Real Shell View shows ONLY missing walls/floors after occupancy checks. It does not promise doors, roof, windows or ornaments.",16,38,430,43,12,C.dim,false,{
            Size=UDim2.new(1,-32,0,36),TextWrapped=true
        })
        button(action,"CONCEPT ONLY",16,86,145,32,false,beginPreview)
        button(action,"REAL SHELL VIEW",170,86,166,32,true,showBuildablePreview)
        button(action,"ACCESS ROUTE",16,122,145,26,false,highlightStairRoute)
        button(action,"CLEAR PREVIEW",170,122,145,26,false,function() clearPreview(false) end)
        text(action,"SIZE: "..lastFootprint,16,151,400,19,10,C.mint,false,{
            Size=UDim2.new(1,-32,0,19),TextWrapped=true
        })

        if state.advancedBuilder then
        local stairsBox=block(scroll,191,C.raised)
        text(stairsBox,"BUILD CATALOG + STAIRS",16,11,420,24,15,C.white,true)
        text(stairsBox,"Optional Shape test ONLY for new staircase pieces. Failed stair tests cannot block structural walls, floors, roofs, doors or wings.",16,37,420,48,11,C.dim,false,{
            Size=UDim2.new(1,-32,0,45),TextWrapped=true
        })
        local status=stairTest.passed and ("VERIFIED / "..tostring(stairCatalog.shape and stairCatalog.shape.name or "Shape")) or stairStatus
        text(stairsBox,status,16,84,425,22,11,stairTest.passed and C.mint or C.orange,true,{
            Size=UDim2.new(1,-32,0,22)
        })
        button(stairsBox,"SCAN ALL ITEMS",16,118,139,32,false,function()
            task.spawn(function()
                scanStairs()
                if alive then switchPage("Builder") end
            end)
        end)
        button(stairsBox,"TEST WALL",350,118,102,32,false,function()
            modal("Test one solid wall?",
                "Only needed if your plot has no existing opaque walls. Tests ONE wall; does not erase the plot.",
                "TEST WALL",testWall)
        end)
        button(stairsBox,"TEST STAIR TREAD",161,118,182,32,stairTest.passed,function()
            modal("Test one actual staircase tread?",
                "Optional diagnostic: tests ONE custom-sized Shape tread and checks server replication. This is NOT required to continue the structural build or other repairs.",
                "PLACE 1 TREAD",testStairShape)
        end)
        local stairList={}
        for i,item in ipairs(stairCatalog.models) do
            if i>5 then break end
            stairList[#stairList+1]=item.name
        end
        text(stairsBox,#stairList>0 and ("Available stair models: "..table.concat(stairList,", ")) or
            "Built-in stair sets: scan the game catalog to identify them.",
            16,157,427,24,10,C.dim,false,{Size=UDim2.new(1,-32,0,27),TextTruncate=Enum.TextTruncate.AtEnd})


        local windowPanel=block(scroll,167,C.raised)
        text(windowPanel,"REAL STRUCTURAL WINDOWS",16,10,440,25,15,C.white,true)
        text(windowPanel,"Windows come from the game's Windows catalog and must attach to a real wall GUID. No fake glass, Shape frames, or blind 63-piece retries.",
            16,36,430,43,11,C.dim,false,{
                Size=UDim2.new(1,-32,0,43),TextWrapped=true
            })
        text(windowPanel,nativeWindow.status,16,81,432,23,11,
            nativeWindow.passed and C.mint or C.orange,true,{
                Size=UDim2.new(1,-32,0,23),
                TextTruncate=Enum.TextTruncate.AtEnd
            })
        button(windowPanel,"1. TEST 1 WINDOW",16,111,159,32,false,function()
            modal("Test one REAL structural window?",
                "Requires an existing wall created by the game. Uses the selected Windows catalog item and the actual wall GUID via PlaceWindow. Places only ONE window and checks whether a new Windows model appears. If rejected, bulk windows stay disabled. May cost game currency.",
                "TEST NATIVE WINDOW",testNativeWindow)
        end)
        button(windowPanel,"2. ADD VERIFIED",181,111,159,32,
            nativeWindow.passed,function()
            if not nativeWindow.passed then
                modal("Native window test required",
                    "The single-window test must confirm an actual Windows model before any additional windows are sent.")
                return
            end
            modal("Add native windows after the walls?",
                "Uses only verified Windows items on server-created wall GUIDs. Skips occupied positions, confirms each window, stops after two consecutive failures and caps the run at 28 windows. No speculative retry loop.",
                "ADD REAL WINDOWS",addNativeWindows)
        end)
        button(windowPanel,"SELECT STYLE",347,111,111,32,false,function()
            buildCatalog.filter="Windows"
            switchPage("Catalog")
        end)
        text(windowPanel,"Build the structure first, then install windows, then decorative Shapes.",
            16,146,430,16,10,C.dim,false,{
                Size=UDim2.new(1,-32,0,16)
            })

        end -- advanced Shape diagnostics and Windows setup
        local completion=block(scroll,369,C.raised)
        text(completion,"ENTRANCE • ROOF • COURTYARD",16,10,440,25,15,C.white,true)
        text(completion,"Non-destructive repairs for the castle already on your plot. Each new placement type starts with a one-piece test.",
            16,37,435,38,11,C.dim,false,{
                Size=UDim2.new(1,-32,0,38),TextWrapped=true
            })
        text(completion,nativeDoor.status,16,78,432,20,10,
            nativeDoor.passed and C.mint or C.orange,false,{
                Size=UDim2.new(1,-32,0,20),TextTruncate=Enum.TextTruncate.AtEnd
            })
        button(completion,"TEST ENTRY DOOR",16,103,168,30,false,function()
            modal("Install one real first-floor door?",
                "Select a Doors catalog style first if desired. The script checks for old masonry blocking the opening, then tests ONE PlaceItem door. If the game requires WallSnap, it will stop rather than try random alternatives. No plot reset.",
                "TEST ONE DOOR",testNativeDoor)
        end)
        button(completion,"SELECT DOOR",192,103,138,30,false,function()
            buildCatalog.filter="Doors"
            switchPage("Catalog")
        end)
        text(completion,roofTest.status,16,140,430,20,10,
            roofTest.passed and C.mint or C.orange,false,{
                Size=UDim2.new(1,-32,0,20),TextTruncate=Enum.TextTruncate.AtEnd
            })
        button(completion,"TEST ONE ROOF",16,164,153,30,false,function()
            modal("Test one genuine pitched roof?",
                "Uses the game's PlaceRoof event with a supported Hip/Gable/Pyramid style, over existing structural walls. ONE request only; further roofs remain locked until a new real roof is confirmed. May cost currency.",
                "TEST ROOF",testNativeRoof)
        end)
        button(completion,"ADD REAL ROOFS",175,164,158,30,
            roofTest.passed,function()
            if not roofTest.passed then
                modal("Roof test required",
                    "The one-roof test must confirm a real server-placed roof first.")
                return
            end
            modal("Complete verified roofs?",
                "Adds only missing roofs with supporting walls, confirming each one and stopping after two consecutive failures. No decorative fake roofs.",
                "ADD ROOFS",addVerifiedRoofs)
        end)
        button(completion,"REPAIR STAIR GAPS",16,203,178,30,false,function()
            modal("Repair missing stair transitions?",
                "Checks the actual plot for matching-size, walkable stair treads and landings. Repairs the missing entry, U-turn and upper exits first. Stops after three unconfirmed requests; no duplicates.",
                "REPAIR STAIRS",repairStairGaps)
        end)
        button(completion,"ADD LOW SIDE WINGS",202,203,175,30,false,function()
            modal("Expand the castle across the plot?",
                "For the two castle designs, add real two-storey side-wing walls and floors around the existing tall hall. Uses the unlocked plot size, skips occupied pieces, confirms each request and stops after repeated failures. No bulldozing.",
                "BUILD WINGS",extendSideWings)
        end)
        button(completion,"FINISH DECORATIONS",16,241,190,31,false,function()
            modal("Finish missing ornaments on this plot?",
                "Adds a bounded set of missing Shape-based details. Each is checked in the real plot and stops after three consecutive unconfirmed requests. Existing walls are untouched. Stair tests are not required for ornament attempts.",
                "ADD ORNAMENTS",finishCastle)
        end)
        button(completion,"WINDOW OPTIONS",214,241,165,31,false,function()
            state.advancedBuilder=true
            switchPage("Builder")
        end)
        button(completion,"FLAT ROOF FALLBACK",16,281,187,31,false,function()
            modal("Try a real flat roof-cap floor?",
                "ONLY if the native pitched roof isn't placing. Tests real PlaceFloor slabs at the roof line over existing supported rooms and checks every result. A flat cap isn't a pitched roof. No existing structures are deleted. This may cost currency.",
                "TRY FLAT ROOF",addFlatRoofCap)
        end)
        button(completion,"FILL DOOR SIDE GAPS",213,281,186,31,false,function()
            modal("Try Shape trim around the real doorway?",
                "Checks the actual installed door width and opening. Attempts only side jambs without covering the door, one at a time. Stops immediately if a Shape fails confirmation. No doors or walls are removed.",
                "TRY SIDE TRIM",repairDoorGaps)
        end)
        text(completion,"Order: scan plot → repair shell → doorway → stairs → genuine roof or flat fallback → ornaments.",
            16,319,435,37,10,C.dim,false,{
                Size=UDim2.new(1,-32,0,37),TextWrapped=true
            })

        if state.advancedBuilder then
        local finishPanel=block(scroll,164,C.raised)
        text(finishPanel,"FINISH OR REPAIR EXISTING CASTLE",16,11,440,26,15,C.white,true)
        text(finishPanel,"Use verified stairs and ornament Shapes AFTER masonry and real windows. Glass-wall repair is unrelated to missing details.",16,39,430,43,11,C.dim,false,{
            Size=UDim2.new(1,-32,0,43),TextWrapped=true
        })
        button(finishPanel,"ADD STAIRS + DECOR",16,90,178,31,stairTest.passed,function()
            modal("Finish the existing castle?",
                "Requires existing structural walls and one verified Shape tread. Attempts up to 85 missing stair/decorative Shapes per run, checking each one and stopping after 3 consecutive unconfirmed pieces. You can rerun for more. No walls are rebuilt.",
                "ADD FINISHES",finishCastle)
        end)
        button(finishPanel,"GLASS WALLS ONLY",201,90,155,31,false,function()
            modal("Test repairing one glass wall?",
                "ONLY for structural walls that mistakenly became transparent glass. This is NOT a window or decoration repair. Skip this test if your masonry and windows look correct. Tests one wall; no bulk change unless confirmed.",
                "TEST FINISH",materialTest)
        end)
        button(finishPanel,"REPAIR ALL GLASS",16,127,178,28,wallRepair.passed,function()
            modal("Restyle existing transparent walls?",
                "The single-wall material test must have succeeded. Applies the same verified material to remaining transparent walls; it never bulldozes or moves existing structures.",
                "REPAIR WALLS",repairGlassWalls)
        end)
        text(finishPanel,wallRepair.status,201,128,235,27,10,wallRepair.passed and C.mint or C.orange,false,{
            Size=UDim2.new(1,-215,0,27),TextTruncate=Enum.TextTruncate.AtEnd
        })

        end -- advanced glass-wall and Shape tools
        local builderPanel=block(scroll,194,C.raised)
        text(builderPanel,"BUILD THIS DESIGN",16,10,425,26,15,C.white,true)
        buildStatusText=text(builderPanel,build.status,16,37,435,23,11,C.mint,false,{Size=UDim2.new(1,-32,0,23)})
        text(builderPanel,"Scan your current plot and fill missing walls/floors without erasing the existing layout. Native roofs, doors, windows and Shapes are independent. Preview is not a guarantee.",16,63,435,47,12,C.dim,false,{
            Size=UDim2.new(1,-32,0,47),TextWrapped=true
        })
        button(builderPanel,"BUILD / REPAIR SHELL",16,115,229,34,false,function()
            modal("Build the missing structural shell?",
                "REAL SHELL VIEW displays the remaining wall and floor placement requests after the current plot is checked. Stair confirmation is NOT required. This action does not build roof, windows, doors, or decorative Shapes. Your existing plot will NOT be erased. Some requests may still fail collision or server checks.",
                "BUILD STRUCTURE",startBuild)
        end)
        button(builderPanel,"STOP",252,115,84,34,false,stopBuild)
        button(builderPanel,"SCAN PLOT",16,156,135,26,false,inspectCurrentPlot)
        button(builderPanel,"VIEW AUDIT",159,156,131,26,false,function()
            modal("Last construction audit",build.lastAudit)
        end)
        button(builderPanel,"COPY LOG",297,156,117,26,false,function()
            local copy=type(setclipboard)=="function" and setclipboard or
                (type(toclipboard)=="function" and toclipboard or nil)
            if not copy then
                notify("Clipboard unavailable. Read VIEW AUDIT or executor log.")
                print("[Plot Studio Build Audit]\n"..tostring(build.lastAudit))
                return
            end
            local ok=pcall(copy,tostring(build.lastAudit))
            notify(ok and "Copied last construction audit." or
                "Clipboard copy failed; check executor log.")
            if not ok then print("[Plot Studio Build Audit]\n"..tostring(build.lastAudit)) end
        end)
        local note=block(scroll,80)
        sectionNote(note,"KEEP YOUR EXISTING PLOT",
            "Build/repair missing walls and floors without stair confirmation. Use the independent door, roof and wing operations for missing features.",7)
    elseif page=="Catalog" then
        pageHead(scroll,"Build Catalog","Live building items discovered in Storage Hunters.")
        local summary=block(scroll,132,C.raised)
        text(summary,"AUTOMATIC BUILD LIBRARY",16,9,440,24,15,C.white,true)
        local statusText=buildCatalog.scanning and buildCatalog.status or
            (buildCatalog.scanned and (tostring(buildCatalog.total).." placeable-item definitions found")
                or ("SCAN STATUS: "..buildCatalog.status))
        text(summary,statusText,16,36,460,23,12,
            buildCatalog.scanned and C.mint or C.orange,true,{
                Size=UDim2.new(1,-32,0,23)
            })
        text(summary,"Only Furniture build categories are scanned. Auction loot, Stock displays and player inventory are excluded.",
            16,60,460,29,11,C.dim,false,{
                Size=UDim2.new(1,-32,0,29),TextWrapped=true
            })
        button(summary,buildCatalog.scanning and "SCANNING..." or "RESCAN BUILD ITEMS",
            16,96,186,28,true,function()
                if stairCatalog.scanning then
                    notify("Scan is already in progress")
                    return
                end
                task.spawn(function()
                    scanStairs()
                    if alive and state.page=="Catalog" then switchPage("Catalog") end
                end)
            end)
        local sources=0
        for _ in pairs(buildCatalog.sources) do sources=sources+1 end
        text(summary,buildCatalog.scanned and
            ("Sources: "..sources.." methods / "..buildCatalog.skipped.." without usable IDs") or
            "Reads the game's replicated build definitions",
            210,97,240,28,10,C.muted,false,{
                Size=UDim2.new(1,-224,0,28),TextTruncate=Enum.TextTruncate.AtEnd
            })

        local features=block(scroll,102)
        text(features,"BUILDING OPTIONS",15,8,410,25,14,C.white,true)
        button(features,"12 ROOF STYLES",15,43,151,30,false,function()
            modal("Roof styles discovered in build modules",
                table.concat(BUILD_ROOF_STYLES,", ")..
                "\n\nRoof styles are an option list, not furniture IDs. The current builder only has verified example data for Flat roofs.")
        end)
        button(features,tostring(#materials).." MATERIALS",174,43,158,30,false,function()
            switchPage("Materials")
        end)
        text(features,"Colors are customizable; they aren't separate purchasable furniture items.",
            15,76,440,20,10,C.dim,false,{
                Size=UDim2.new(1,-30,0,20)
            })

        local cats=block(scroll,212)
        text(cats,"BUILD CATEGORIES",14,7,440,24,14,C.white,true)
        local catsList={"All"}
        for _,cat in ipairs(BUILD_CATEGORIES) do catsList[#catsList+1]=cat end
        for i,cat in ipairs(catsList) do
            local count=cat=="All" and #buildCatalog.entries or
                #(buildCatalog.byCategory[cat] or {})
            local chosen=buildCatalog.filter==cat
            local label=cat.."  ("..count..")"
            local buttonCat=button(cats,label,0,0,100,27,chosen,function()
                buildCatalog.filter=cat
                switchPage("Catalog")
            end)
            local c=(i-1)%3
            local r=math.floor((i-1)/3)
            buttonCat.Position=UDim2.new(c/3,6,0,35+r*33)
            buttonCat.Size=UDim2.new(1/3,-12,0,28)
            buttonCat.TextSize=10
        end

        local queryCard=block(scroll,57)
        local searchBox=corner(ui("TextBox",{
            BackgroundColor3=C.raised,BorderSizePixel=0,
            Position=UDim2.fromOffset(10,9),
            Size=UDim2.new(1,-20,0,36),
            Text=buildCatalog.query,
            PlaceholderText="Search by building name or item ID...",
            TextColor3=C.white,PlaceholderColor3=C.muted,
            Font=Enum.Font.Gotham,TextSize=12,
            ClearTextOnFocus=false,TextXAlignment=Enum.TextXAlignment.Left
        },queryCard),8)
        ui("UIPadding",{
            PaddingLeft=UDim.new(0,11),PaddingRight=UDim.new(0,10)
        },searchBox)
        local resultPanel=ui("Frame",{
            BackgroundTransparency=1,BorderSizePixel=0,
            Size=UDim2.new(1,0,0,46),
        },scroll)
        local resultMax=75
        local function drawResults()
            for _,child in ipairs(resultPanel:GetChildren()) do child:Destroy() end
            local term=buildCatalog.query:lower()
            local found={}
            local rows=buildCatalog.filter=="All" and buildCatalog.entries or
                (buildCatalog.byCategory[buildCatalog.filter] or {})
            local matchTotal=0
            for _,row in ipairs(rows) do
                if term=="" or row.name:lower():find(term,1,true)
                    or row.id:lower():find(term,1,true) then
                    matchTotal=matchTotal+1
                    if #found<resultMax then found[#found+1]=row end
                end
            end
            local head=corner(ui("Frame",{
                BackgroundColor3=C.panel,BorderSizePixel=0,
                Position=UDim2.fromOffset(0,0),
                Size=UDim2.new(1,0,0,33)
            },resultPanel),8)
            text(head,
                tostring(matchTotal).." matching build items"..
                (matchTotal>resultMax and (" / first "..resultMax.." shown") or ""),
                12,0,470,33,11,C.mint,true,{
                    Size=UDim2.new(1,-22,0,33)
                })
            local rowHeight=39
            resultPanel.Size=UDim2.new(1,0,0,39+#found*rowHeight)
            if matchTotal==0 then
                text(resultPanel,buildCatalog.scanned and
                    "No matching items found. Try Rescan or another category." or
                    "Catalog has not finished scanning.",
                    7,38,400,32,11,C.dim,false,{
                        Size=UDim2.new(1,-14,0,32)
                    })
                resultPanel.Size=UDim2.new(1,0,0,78)
            end
            for idx,item in ipairs(found) do
                local row=corner(ui("TextButton",{
                    BackgroundColor3=idx%2==0 and C.panel or C.raised,
                    BorderSizePixel=0,
                    Position=UDim2.fromOffset(0,35+(idx-1)*rowHeight),
                    Size=UDim2.new(1,0,0,35),
                    Text="",AutoButtonColor=true
                },resultPanel),7)
                text(row,item.name,11,2,330,19,12,C.white,true,{
                    Size=UDim2.new(1,-85,0,19)
                })
                text(row,item.category.."  ·  ID "..item.id,11,20,365,13,10,C.dim,false,{
                    Size=UDim2.new(1,-85,0,13)
                })
                local cell=text(row,"DETAILS",0,0,64,35,10,C.purple,true,{
                    Position=UDim2.new(1,-70,0,0)
                })
                on(row.MouseButton1Click,function()
                    local message="Category: "..item.category.."\nItem ID: "..item.id..
                        "\nSource: "..item.source..
                        "\n\nFound in the game's plot building catalog, not your auction inventory."
                    local label="CLOSE"
                    local action
                    if item.category=="Walls" and scoreWall(item.name)>=0 then
                        message=message..
                            "\n\nSet as the wall candidate for this blueprint? The wall must still pass a one-wall material/opacity test."
                        label="USE AS WALL"
                        action=function()
                            stairCatalog.wall={
                                id=item.id,name=item.name,category="Walls",
                                score=scoreWall(item.name)
                            }
                            build.passed=false
                            notify("Wall candidate: "..item.name..". Retest one wall first.")
                        end
                    elseif item.category=="Shapes" then
                        local lo=item.name:lower()
                        if lo:find("block",1,true) or lo:find("cube",1,true)
                            or lo:find("box",1,true) then
                            message=message..
                                "\n\nSet as the custom staircase/decor Shape? Test one tread before any bulk build."
                            label="USE AS SHAPE"
                            action=function()
                                stairCatalog.shape={
                                    id=item.id,name=item.name,category="Shapes"
                                }
                                stairTest.passed=false
                                notify("Shape candidate: "..item.name..". Retest stair tread.")
                            end
                        end
                    elseif item.category=="Doors" then
                        message=message..
                            "\n\nSelect this genuine Doors catalog item for a ONE-DOOR test at the ground-floor entrance. The test uses PlaceItem and must be confirmed in the plot."
                        label="SELECT DOOR"
                        action=function()
                            nativeDoor.id=item.id
                            nativeDoor.name=item.name
                            nativeDoor.passed=false
                            nativeDoor.signature=nil
                            nativeDoor.status="Selected "..item.name.." / test one entrance"
                            notify("Native entrance door selected: "..item.name)
                        end
                    elseif item.category=="Windows" then
                        message=message..
                            "\n\nUse this real structural window style for the native PlaceWindow stage? Requires a wall GUID and a successful single-window test."
                        label="SELECT WINDOW"
                        action=function()
                            nativeWindow.id=item.id
                            nativeWindow.name=item.name
                            nativeWindow.passed=false
                            nativeWindow.signature=nil
                            nativeWindow.status="Selected "..item.name.." / TEST ONE WINDOW required"
                            notify("Native window selected: "..item.name)
                        end
                    else
                        message=message..
                            "\n\nDiscovered and indexed. Automatic placement is not yet implemented for every category; it needs tested placement geometry."
                    end
                    modal(item.name,message,label,action)
                end)
            end
        end
        on(searchBox:GetPropertyChangedSignal("Text"),function()
            buildCatalog.query=searchBox.Text
            drawResults()
        end)
        drawResults()

    elseif page=="Materials" then
        pageHead(scroll,"Material director","The studio automatically picks a different finish for each architectural feature.")
        local current=block(scroll,102,C.raised)
        local chosenStyle=DESIGN_STYLES[state.design] or DESIGN_STYLES[1]
        text(current,state.autoStyle and "AUTO CURATED STYLE" or "MANUAL MATERIAL OVERRIDE",14,9,310,19,10,C.dim,true)
        text(current,state.autoStyle and chosenStyle.name or state.material,14,30,350,28,19,C.white,true,{Size=UDim2.new(1,-82,0,28)})
        local chip=corner(ui("Frame",{
            AnchorPoint=Vector2.new(1,0),
            Position=UDim2.new(1,-17,0,17),Size=UDim2.fromOffset(48,48),
            BackgroundColor3=state.autoStyle and chosenStyle.wallColor or state.color,BorderSizePixel=0
        },current),11)
        border(chip,C.line,1,0.15)
        text(current,state.autoStyle and ("Walls "..chosenStyle.wall.." / Roof "..chosenStyle.roof.." / Floor "..chosenStyle.floor) or ("Accent: "..state.colorName),14,67,410,19,11,C.dim,false,{
            Size=UDim2.new(1,-25,0,19)
        })

        local colors=block(scroll,77)
        text(colors,"COLOR PRESETS",14,5,240,21,11,C.dim,true)
        local colorRow=ui("Frame",{BackgroundTransparency=1,
            Position=UDim2.fromOffset(13,30),Size=UDim2.new(1,-26,0,36)
        },colors)
        ui("UIListLayout",{FillDirection=Enum.FillDirection.Horizontal,
            SortOrder=Enum.SortOrder.LayoutOrder,Padding=UDim.new(0,8)},colorRow)
        for i,entry in ipairs(swatches) do
            local b=corner(ui("TextButton",{
                BackgroundColor3=entry[1],BorderSizePixel=0,Text="",
                Size=UDim2.new(1/#swatches,-7,0,27),LayoutOrder=i
            },colorRow),7)
            if entry[2]==state.colorName then border(b,C.white,2,0) end
            on(b.MouseButton1Click,function()
                state.color=entry[1]
                state.colorName=entry[2]
                state.autoStyle=false
                if previewFolder then beginPreview() end
                switchPage("Materials")
            end)
        end
        local searchFrame=block(scroll,52)
        local input=corner(ui("TextBox",{
            BackgroundColor3=C.raised,BorderSizePixel=0,
            Position=UDim2.fromOffset(10,8),Size=UDim2.new(1,-20,0,35),
            Text="",PlaceholderText="Search materials...",
            TextColor3=C.white,PlaceholderColor3=C.muted,Font=Enum.Font.Gotham,
            TextSize=12,ClearTextOnFocus=false,TextXAlignment=Enum.TextXAlignment.Left,
        },searchFrame),8)
        ui("UIPadding",{PaddingLeft=UDim.new(0,11),PaddingRight=UDim.new(0,11)},input)
        local matWrap=block(scroll,315)
        local list=ui("ScrollingFrame",{
            BackgroundTransparency=1,BorderSizePixel=0,
            Position=UDim2.fromOffset(8,8),Size=UDim2.new(1,-16,1,-16),
            CanvasSize=UDim2.fromOffset(0,0),AutomaticCanvasSize=Enum.AutomaticSize.Y,
            ScrollBarThickness=3,ScrollBarImageColor3=C.purpleDark,
        },matWrap)
        local matLayout=ui("UIListLayout",{
            SortOrder=Enum.SortOrder.LayoutOrder,Padding=UDim.new(0,5)
        },list)
        local function refreshMaterials()
            for _,child in ipairs(list:GetChildren()) do
                if child~=matLayout then child:Destroy() end
            end
            local q=input.Text:lower()
            for i,name in ipairs(materials) do
                if name:lower():find(q,1,true) then
                    local selected=name==state.material
                    local row=corner(ui("TextButton",{
                        Size=UDim2.new(1,-5,0,35),
                        LayoutOrder=i,Text="",
                        BackgroundColor3=selected and C.purpleDark or C.raised,
                        BorderSizePixel=0,AutoButtonColor=true
                    },list),8)
                    text(row,string.format("%02d",i),10,0,27,35,10,C.purple,true)
                    text(row,name,41,0,260,35,12,selected and C.white or C.dim,true,{
                        Size=UDim2.new(1,-95,0,35)
                    })
                    if selected then text(row,"✓",0,0,22,35,15,C.mint,true,{
                        AnchorPoint=Vector2.new(1,0),Position=UDim2.new(1,-12,0,0)
                    }) end
                    on(row.MouseButton1Click,function()
                        state.material=name
                        state.autoStyle=false
                        if previewFolder then beginPreview() end
                        notify(name.." selected")
                        switchPage("Materials")
                    end)
                end
            end
        end
        on(input:GetPropertyChangedSignal("Text"),refreshMaterials)
        refreshMaterials()
    elseif page=="Settings" then
        pageHead(scroll,"Studio preferences","Local interface settings only. No server changes.")
        local function settingsRow(title,description,key)
            local f=block(scroll,73)
            text(f,title,15,10,350,24,14,C.white,true,{Size=UDim2.new(1,-100,0,24)})
            text(f,description,15,36,360,23,11,C.dim,false,{Size=UDim2.new(1,-100,0,23)})
            local t=button(f,state[key] and "ON" or "OFF",0,18,62,34,state[key],function()
                state[key]=not state[key]
                if key=="compact" then updateSidebar() end
                switchPage("Settings")
            end)
            t.AnchorPoint=Vector2.new(1,0)
            t.Position=UDim2.new(1,-15,0,18)
        end
        settingsRow("Automatic design materials","Mix stone, roof, floor, metal and glass by design","autoStyle")
        settingsRow("Confirm before building","Safety confirmation for future builds","confirm")
        settingsRow("Grid and placement outlines","Future layout preview preference","grid")
        settingsRow("Toast notifications","Show in-studio messages","notifications")
        settingsRow("Compact navigation","Make more room for content","compact")
        local about=block(scroll,119,C.raised)
        sectionNote(about,"PLOT STUDIO  •  VERSION 2.3",
            "Independent of Syndicate Hub. Local previews are conceptual; build actions can permanently place structures.",12)
        button(about,"ABOUT THE PROJECT",16,83,174,27,false,function()
            modal("About Plot Studio",
                "A standalone building interface for Storage Hunters.\n\nPlanned: blueprint import/export, community library, real material assignment, building verification, and safe stop/resume. The current version is only a GUI demonstration.")
        end)
    end
end

local function closeStudio()
    if not alive then return end
    alive=false
    build.cancel=true
    clearPreview(true)
    for _, connection in ipairs(connections) do
        pcall(function() connection:Disconnect() end)
    end
    if env[KEY]==closeStudio then env[KEY]=nil end
    gui:Destroy()
end
env[KEY]=closeStudio

local float = corner(ui("TextButton",{
    Name="PlotStudioRestore",Visible=false,
    Size=UDim2.fromOffset(49,49),Position=UDim2.new(0.5,-24,0,15),
    BackgroundColor3=C.purpleDark,BorderSizePixel=0,
    Text="♥",Font=Enum.Font.GothamBold,TextSize=29,
    TextColor3=C.purple,AutoButtonColor=true,
},gui),15)
border(float,C.purple,1.5,0)
on(minus.MouseButton1Click,function() win.Visible=false;float.Visible=true end)
on(close.MouseButton1Click,closeStudio)
local justDragged=false
on(float.MouseButton1Click,function()
    if justDragged then justDragged=false;return end
    float.Visible=false;win.Visible=true
end)

local dragging=nil
local dragStart, windowStart
local resizing=nil
local resizeStart, sizeStart
local floatDragging=nil
local floatStart, floatPosition
on(header.InputBegan,function(input)
    if input.UserInputType==Enum.UserInputType.MouseButton1 or input.UserInputType==Enum.UserInputType.Touch then
        dragging=input;dragStart=input.Position;windowStart=win.Position
    end
end)
on(resize.InputBegan,function(input)
    if input.UserInputType==Enum.UserInputType.MouseButton1 or input.UserInputType==Enum.UserInputType.Touch then
        resizing=input;resizeStart=input.Position;sizeStart=win.AbsoluteSize
    end
end)
on(float.InputBegan,function(input)
    if input.UserInputType==Enum.UserInputType.MouseButton1 or input.UserInputType==Enum.UserInputType.Touch then
        floatDragging=input;floatStart=input.Position;floatPosition=float.Position
    end
end)
on(UserInputService.InputChanged,function(input)
    local isMouse=input.UserInputType==Enum.UserInputType.MouseMovement
    if dragging and (input==dragging or isMouse) then
        local d=input.Position-dragStart
        win.Position=UDim2.new(windowStart.X.Scale,windowStart.X.Offset+d.X,windowStart.Y.Scale,windowStart.Y.Offset+d.Y)
    end
    if resizing and (input==resizing or isMouse) then
        local d=input.Position-resizeStart
        local screen=workspace.CurrentCamera and workspace.CurrentCamera.ViewportSize or viewport
        win.Size=UDim2.fromOffset(
            math.clamp(sizeStart.X+d.X,330,math.max(330,screen.X-12)),
            math.clamp(sizeStart.Y+d.Y,390,math.max(390,screen.Y-12))
        )
        updateSidebar()
    end
    if floatDragging and (input==floatDragging or isMouse) then
        local d=input.Position-floatStart
        if d.Magnitude>7 then justDragged=true end
        float.Position=UDim2.new(floatPosition.X.Scale,floatPosition.X.Offset+d.X,floatPosition.Y.Scale,floatPosition.Y.Offset+d.Y)
    end
end)
on(UserInputService.InputEnded,function(input)
    if dragging and (input==dragging or (dragging.UserInputType==Enum.UserInputType.MouseButton1 and input.UserInputType==Enum.UserInputType.MouseButton1)) then dragging=nil end
    if resizing and (input==resizing or (resizing.UserInputType==Enum.UserInputType.MouseButton1 and input.UserInputType==Enum.UserInputType.MouseButton1)) then resizing=nil end
    if floatDragging and (input==floatDragging or (floatDragging.UserInputType==Enum.UserInputType.MouseButton1 and input.UserInputType==Enum.UserInputType.MouseButton1)) then floatDragging=nil end
end)

updateSidebar()
switchPage("Overview")
task.spawn(function()
    task.wait(.15)
    if alive and not stairCatalog.scanned and not stairCatalog.scanning then
        scanStairs()
        if alive and (state.page=="Catalog" or state.page=="Builder" or
            state.page=="Overview") then
            switchPage(state.page)
        end
    end
end)
print("[Plot Studio] v2.3 live plot snapshots, safer confirmed repairs, roof-cap fallback, Shape diagnostics.")
