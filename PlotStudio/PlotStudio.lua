--[[
    PLOT STUDIO | Storage Hunters
    Standalone GUI v0.5 with plot-sized ornate previews and adjustable fast construction pacing
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
    {name = "Grand Citadel", category = "CASTLES", floors = 5, subtitle = "Four towers  /  open marketplace ground floor", tag = "FEATURED"},
    {name = "Blackstone Fortress", category = "CASTLES", floors = 4, subtitle = "Basalt stronghold  /  crenellated walls", tag = "CONCEPT"},
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
    buildSpeed = "Fast", autoStyle = true,
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
text(header, "PLOT STUDIO", 65, 12, 245, 25, 19, C.white, true)
text(header, "STORAGE HUNTERS  /  BLUEPRINT LAB", 65, 36, 280, 17, 10, C.dim, false)
local headerStatus = corner(ui("Frame", {
    AnchorPoint = Vector2.new(1, 0.5),
    Position = UDim2.new(1, -112, 0.5, 0),
    Size = UDim2.fromOffset(102, 25),
    BackgroundColor3 = C.purpleDark, BorderSizePixel = 0,
}, header), 12)
text(headerStatus, "●  BUILD BETA", 8, 0, 92, 25, 10, C.white, true)

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
    {"Materials", "04"},
    {"Settings", "05"}
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
local sidebarBottom = text(sidebar, "VERSION 0.3  •  PREVIEW", 15, 0, 164, 18, 10, C.muted, true)
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
local footLabel = text(footer, "●  SAFE DEMO  ·  No build events are fired", 13, 3, 510, 30, 10, C.mint, true)
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
    width=math.clamp((width or 180)*.93,64,171)
    depth=math.clamp((depth or 180)*.93,64,171)
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
    -- Explicit kind is vital: decorations must never be interpreted as wall requests.
    local function part(name,kind,x,y,z,sx,sy,sz,rot,color)
        if count>=1080 then return end
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
        p.Transparency=kind=="Glass" and .25 or (kind=="Decor" and .32 or .63)
        p.Size=Vector3.new(sx,sy,sz)
        p.CFrame=origin*CFrame.new(x,y,z)*CFrame.Angles(0,rot or 0,0)
        p:SetAttribute("PlotStudioKind",kind)
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
    local function glaze(x,y,z,sx,sy,rot)
        return part("Stained glass","Glass",x,y,z,sx,sy,.22,rot,glass)
    end
    local function crenels(x,z,len,y,rot)
        wall("Rampart",x,y,z,len,2.3,rot,dark)
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
            glaze(px,y,pz,3,h*.38,rot)
            deco("Stone lintel",px,y+h*.22,pz,5,.65,1.25,light,rot)
            deco("Window sill",px,y-h*.23,pz,4.5,.55,1.15,light,rot)
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
            wall("Doorway lintel",cx,lv*h+h*.89,cz-dz/2,open,h*.22,0,light)
            if lv>0 then
                deco("Upper landing balcony",cx,lv*h-.1,cz-dz/2-3,open+3,.4,5,light)
                for _,sign in ipairs({-1,1}) do
                    deco("Balustrade pillar",cx+sign*(open/2+1),lv*h+1.7,cz-dz/2-5,.55,3.4,.55,light)
                end
            else
                deco("Gothic door surround",cx,lv*h+h*.83,cz-dz/2-.75,open+2,.8,1.6,light)
            end
        else
            wall("South wall",cx,cy,cz-dz/2,wx,h,0,col)
        end
        if lv>0 then
            openings(cx,cz+dz/2,wx,lv,0)
            openings(cx,cz-dz/2,wx,lv,0)
        end
    end
    local function tower(x,z,r,levels,spire)
        for level=0,levels-1 do
            local y=level*h+h/2
            local facet=r*1.16
            for _,rot in ipairs({0,math.pi/2}) do
                for _,s in ipairs({-1,1}) do
                    local px=x+(rot==0 and 0 or s*r)
                    local pz=z+(rot==0 and s*r or 0)
                    wall("Turret face",px,y,pz,facet,h,rot,dark)
                end
            end
            for _,sx in ipairs({-1,1}) do
                for _,sz in ipairs({-1,1}) do
                    wall("Octagonal corner",x+sx*r*.69,y,z+sz*r*.69,r*.82,h,
                        sx==sz and -math.pi/4 or math.pi/4,dark)
                end
            end
            if level>0 then deck("Floor",x,level*h-.28,z,r*2.1,r*2.1,stone) end
            deco("Turret cornice",x,(level+1)*h-.35,z,r*2.2,.8,r*2.2,light)
            if level>=1 then glaze(x,level*h+h*.55,z-r-.1,2.5,h*.3,0) end
        end
        local top=levels*h
        deco("Crown cornice",x,top+.15,z,r*2.3,1,r*2.3,light)
        for j=1,8 do
            local ang=j*math.pi/4
            deco("Tower battlement",x+r*math.cos(ang),top+2,z+r*math.sin(ang),2.4,3.1,2.4,dark)
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
    local function galleryWithWell(cx,cz,wx,dz,lv)
        if lv<1 then return end
        local wellX=wx*.17
        local wellW=math.max(12,wx*.22)
        local wellD=math.max(23,dz*.65)
        local west=wellX-wellW/2
        local east=wellX+wellW/2
        local leftW=west+wx/2
        local rightW=wx/2-east
        local yy=lv*h-.28
        if leftW>2 then deck("Gallery floor",cx-wx/2+leftW/2,yy,cz,leftW,dz-2,stone) end
        if rightW>2 then deck("Gallery floor",cx+east+rightW/2,yy,cz,rightW,dz-2,stone) end
        local strip=(dz-wellD)/2
        if strip>2 then
            deck("North landing",cx+wellX,yy,cz+wellD/2+strip/2,wellW,strip,stone)
            deck("South landing",cx+wellX,yy,cz-wellD/2-strip/2,wellW,strip,stone)
        end
        for _,side in ipairs({-1,1}) do
            local bx=cx+wellX+side*wellW/2
            deco("Open atrium balustrade",bx,lv*h+1.4,cz,.6,2.8,wellD,light)
        end
    end
    local function grandStaircase(cx,cz,wx,dz,levels)
        local wellX=wx*.17
        local wellD=math.max(23,dz*.65)
        local treadW=math.max(6,wx*.10)
        local n=18
        for lv=0,levels-2 do
            for i=1,n do
                local t=(i-.5)/n
                local direction=lv%2==0 and 1 or -1
                local px=cx+wellX
                local pz=cz-direction*(wellD*.43)+direction*t*wellD*.86
                local yy=lv*h+t*h
                deco("Stair tread",px,yy,pz,treadW,.65,wellD*.86/n+.25,
                    lv%2==0 and light or stone)
            end
            for _,side in ipairs({-1,1}) do
                local px=cx+wellX+side*(treadW/2+.7)
                deco("Stair railing",px,lv*h+h*.58,cz,.55,h*.90,wellD*.84,light)
            end
            deco("Intermediate landing",cx+wellX,(lv+1)*h-.2,
                cz+(lv%2==0 and 1 or -1)*wellD*.44,treadW+3,.6,4,light)
        end
    end

    local function lantern(x,z)
        deco("Lantern plinth",x,.45,z,2,1.1,2,dark)
        deco("Lantern pedestal",x,2.8,z,.6,4.6,.6,light)
        deco("Lantern",x,5.7,z,1.7,1.8,1.7,gold)
    end

    if state.design==1 or state.design==2 then
        local majestic=state.design==1
        local ox,oz=w*.42,d*.42
        local r=math.clamp(math.min(w,d)*.083,6.5,13)
        -- Huge outside walls follow the property instead of the old 56-stud box.
        wall("Northern rampart",0,h*.68,oz,ox*2,h*1.36,0,dark)
        wall("Western rampart",-ox,h*.68,0,oz*2,h*1.36,math.pi/2,dark)
        wall("Eastern rampart",ox,h*.68,0,oz*2,h*1.36,math.pi/2,dark)
        local door=math.min(20,w*.16)
        local side=(ox*2-door)/2
        wall("West gate wall",-(door+side)/2,h*.68,-oz,side,h*1.36,0,dark)
        wall("East gate wall",(door+side)/2,h*.68,-oz,side,h*1.36,0,dark)
        wall("Vaulted gateway",0,h*1.2,-oz,door,h*.3,0,light)
        for _,x in ipairs({-ox,ox}) do
            for _,z in ipairs({-oz,oz}) do tower(x,z,r,floors+1,majestic) end
        end
        crenels(0,oz,ox*2,h*1.36,0)
        crenels(-ox,0,oz*2,h*1.36,math.pi/2)
        crenels(ox,0,oz*2,h*1.36,math.pi/2)
        -- Rear keep allows a sprawling ceremonial courtyard and usable ground floor.
        local kw,kd=w*.52,d*.39
        local kz=d*.12
        for lv=0,floors-1 do
            walls(0,kz,kw,kd,lv,majestic and stone or dark,true)
            galleryWithWell(0,kz,kw-2,kd-2,lv)
            deco("Carved floor cornice",0,(lv+1)*h-.35,kz,kw+1,1.2,kd+1,light)
        end
        grandStaircase(0,kz,kw-2,kd-2,floors)
        deco("Crowned keep roof",0,floors*h-.3,kz,kw+1,.8,kd+1,roof)
        for _,z in ipairs({kz-kd/2,kz+kd/2}) do crenels(0,z,kw,floors*h+1,0) end
        for _,x in ipairs({-kw/2,kw/2}) do crenels(x,kz,kd,floors*h+1,math.pi/2) end
        if majestic then
            tower(0,kz,math.min(kw*.17,12),floors+2,true)
            tower(-kw*.31,kz+kd*.25,math.min(kw*.11,8),floors+1,true)
            tower(kw*.31,kz+kd*.25,math.min(kw*.11,8),floors+1,true)
        else
            tower(-kw*.31,kz,math.min(kw*.13,10),floors+1,false)
            tower(kw*.31,kz,math.min(kw*.13,10),floors+1,false)
        end
        -- Twin entrance towers and stone columns across the whole forecourt.
        for _,x in ipairs({-door*1.12,door*1.12}) do tower(x,-oz,r*.77,3,majestic) end
        for _,x in ipairs({-w*.23,w*.23}) do columns(x,-d*.11,d*.27,"Z") end
        for _,x in ipairs({-w*.31,w*.31}) do lantern(x,-d*.28) end
        deco("Grand courtyard promenade",0,.17,-d*.23,w*.24,.3,d*.26,light)
        for _,x in ipairs({-ox,ox}) do
            for _,z in ipairs({-oz,oz}) do
                deco("Royal banner staff",x,(floors+1)*h+8,z,.7,10,.7,gold)
                deco("Purple royal banner",x+1.9,(floors+1)*h+8,z,3.7,6,.3,primary)
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
            deco("Palace roof terrace",x,floors*h-.3,d*.06,wingW+2,.8,wingD+2,roof)
            grandStaircase(x,d*.06,wingW,wingD,floors)
            columns(x,-d*.31,wingW,"X")
            for _,z in ipairs({-d*.21,d*.27}) do tower(x,z,math.min(wingW*.23,10),floors+1,true) end
        end
        for lv=0,floors-1 do
            walls(0,d*.3,w*.43,d*.22,lv,stone,lv==0)
            if lv>0 then deck("Gallery floor",0,lv*h-.3,d*.3,w*.43,d*.22,light) end
        end
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
        deck("Roof terrace",0,floors*h+.3,0,wx+3,dz+3,light)
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
        deco("Watchtower crest roof",0,floors*h-.3,0,size+3,.8,size+3,roof)
        tower(0,0,math.min(size*.24,13),floors+4,true)
        for _,x in ipairs({-w*.36,w*.36}) do
            tower(x,d*.27,math.min(w*.073,9),floors+1,false)
            deco("Suspended skybridge",x*.5,h*.9,d*.15,math.abs(x),1.2,6,light)
        end
        crenels(0,-size/2,size,floors*h+1,0)
    end
    notify("DESIGN PREVIEW: "..count.." curated pieces / "..profile.name..
        " / stairways shown for planning (not yet buildable)")
    if state.page=="Builder" and switchPage then switchPage("Builder") end
end

-- Build engine v0.3. The first real action is always a one-wall test.
local build={busy=false,cancel=false,passed=false,signature=nil,firstIndex=nil,status="Not started",sent=0,total=0}
-- Timing presets apply only to actual construction requests.
-- Delays are intentionally bounded to avoid an unbounded remote spam loop.
local BUILD_SPEEDS={
    Steady={interval=.24,burst=12,cooldown=.12},
    Fast={interval=.08,burst=18,cooldown=.12},
    Turbo={interval=.045,burst=20,cooldown=.10},
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
    if hi-lo<.55 then return nil end
    return math.max(0,lo-.25),math.min(l,hi+.25)
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
        result[#result+1]={kind="Wall",lv=unit.lv,
            a=unit.a:Lerp(unit.b,range[1]/len),
            b=unit.a:Lerp(unit.b,range[2]/len)}
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
                if m:IsA("Model") and not seen[m] then
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
                            local ok,box,size=pcall(function() return m:GetBoundingBox() end)
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
local stairCatalog={
    scanned=false,scanning=false,models={},shape=nil,wall=nil,walls={},error=nil
}
local stairStatus="Building catalog: auto-scan when opening Builder"
local function scanStairs()
    if stairCatalog.scanning then return false end
    stairCatalog.scanning=true
    stairStatus="Scanning available stairs, shapes and walls..."
    local ok,registry=pcall(function()
        return require(game:GetService("ReplicatedStorage").Modules.Furniture)
    end)
    if not ok or type(registry)~="table" or type(registry.GetById)~="function" then
        stairCatalog.scanned=false
        stairCatalog.scanning=false
        stairCatalog.error="Furniture catalog unavailable"
        stairStatus=stairCatalog.error
        notify(stairStatus)
        return false
    end
    local models,shapes,walls={},{},{}
    local known={}
    local function inspect(data,fallback)
        if type(data)~="table" then return end
        local id=tostring(data.Id or data.ID or data.ItemId or data.id or fallback or "")
        local category=tostring(data.Category or "")
        local label=tostring(data.Name or data.DisplayName or "")
        if id=="" or label=="" or known[id] then return end
        known[id]=true
        local lower=label:lower()
        if lower:find("stair",1,true) or lower:find("steps",1,true) then
            models[#models+1]={id=id,name=label,category=category,data=data}
        end
        if category=="Shapes" and (lower:find("block",1,true)
            or lower:find("cube",1,true) or lower:find("box",1,true)) then
            shapes[#shapes+1]={id=id,name=label,category=category,data=data}
        end
        if category=="Walls" then
            local score=0
            if lower:find("glass",1,true) or lower:find("clear",1,true)
                or lower:find("window",1,true) or lower:find("transparent",1,true) then
                score=-999
            else
                if lower:find("stone",1,true) then score=score+140 end
                if lower:find("brick",1,true) then score=score+110 end
                if lower:find("solid",1,true) then score=score+100 end
                if lower:find("plaster",1,true) then score=score+90 end
                if lower:find("plain",1,true) then score=score+80 end
                if lower:find("wood",1,true) then score=score+65 end
                if lower:find("wall",1,true) then score=score+35 end
            end
            walls[#walls+1]={id=id,name=label,score=score,data=data}
        end
    end
    -- The game furniture module exposes GetById. Scan candidate catalog IDs.
    for i=1,2400 do
        local okItem,data=pcall(function() return registry:GetById(tostring(i)) end)
        if okItem then inspect(data,i) end
        if i%250==0 then task.wait() end
    end
    table.sort(models,function(x,y)return x.name<y.name end)
    table.sort(shapes,function(x,y)
        local function rank(v)
            local n=v.name:lower()
            return (n:find("cube",1,true) and 20 or 0)
                +(n:find("block",1,true) and 10 or 0)
        end
        return rank(x)>rank(y)
    end)
    table.sort(walls,function(x,y)
        if x.score~=y.score then return x.score>y.score end
        return x.name<y.name
    end)
    stairCatalog.models=models
    stairCatalog.shape=shapes[1]
    stairCatalog.walls=walls
    stairCatalog.wall=walls[1] and walls[1].score>=0 and walls[1] or nil
    stairCatalog.scanned=true
    stairCatalog.scanning=false
    stairCatalog.error=nil
    stairStatus="Found "..#models.." stairs / "..#shapes.." block shapes / "..#walls.." wall styles"
    notify(stairStatus)
    return true
end
local function ensureCatalog()
    if stairCatalog.scanned then return true end
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
                        color=p:GetAttribute("PlotStudioColor"),
                        material=p:GetAttribute("PlotStudioMaterial")}
                end end
            elseif kind=="Roof" then
                local lv=math.clamp(math.floor((p.Position.Y-origin.Position.Y+.4)/h+.1)-1,0,4)
                local cf=origin:ToObjectSpace(p.CFrame)
                local nx,nz=math.ceil(p.Size.X/40),math.ceil(p.Size.Z/40)
                for ix=1,nx do for iz=1,nz do
                    local sx,sz=p.Size.X/nx,p.Size.Z/nz
                    local c=cf*CFrame.new((ix-.5)*sx-p.Size.X/2,0,(iz-.5)*sz-p.Size.Z/2)
                    units[#units+1]={kind="Roof",x=c.Position.X,z=c.Position.Z,sx=sx,sz=sz,lv=lv}
                end end
            elseif kind=="Wall" then
                local lv=math.clamp(math.floor((p.Position.Y-origin.Position.Y)/h),0,4)
                local count=math.ceil(p.Size.X/15)
                for k=1,count do
                    local x1=-p.Size.X/2+(k-1)*p.Size.X/count
                    local x2=-p.Size.X/2+k*p.Size.X/count
                    local a=p.CFrame:PointToWorldSpace(Vector3.new(x1,-p.Size.Y/2,0))
                    local b=p.CFrame:PointToWorldSpace(Vector3.new(x2,-p.Size.Y/2,0))
                    units[#units+1]={kind="Wall",a=a,b=b,lv=lv,
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
        if p:IsA("BasePart") and p.Name=="Stair tread" then
            result[#result+1]={
                kind="StairShape",
                id=stairCatalog.shape.id,
                cf=p.CFrame,
                size=p.Size,
                color=p:GetAttribute("PlotStudioColor"),
                material=p:GetAttribute("PlotStudioMaterial"),
                lv=math.clamp(math.floor((p.Position.Y-origin.Position.Y)/h),0,4)
            }
        end
    end
    table.sort(result,function(a,b)
        if a.lv~=b.lv then return a.lv<b.lv end
        return a.cf.Position.Y<b.cf.Position.Y
    end)
    return result
end
local function sameStairUnit(a,b)
    return a and b and a.id==b.id and (a.cf.Position-b.cf.Position).Magnitude<.45
end
local function verifyPlacedStair(plot,request,before)
    local furniture=plot:FindFirstChild("Furniture")
    if not furniture then return false end
    for _,model in ipairs(furniture:GetChildren()) do
        if model:IsA("Model") and not before[model] and
            tostring(model:GetAttribute("ItemId") or "")==tostring(request.id) then
            if (model:GetPivot().Position-request.cf.Position).Magnitude<8 then
                return true
            end
        end
    end
    return false
end
local function stairsAlreadyPresent(plot,u)
    local furniture=plot:FindFirstChild("Furniture")
    if not furniture then return false end
    for _,model in ipairs(furniture:GetChildren()) do
        if model:IsA("Model") and
            tostring(model:GetAttribute("ItemId") or "")==tostring(u.id) then
            if (model:GetPivot().Position-u.cf.Position).Magnitude<1.3 then
                return true
            end
        end
    end
    return false
end

local function fireUnit(u)
    local eventName=(u.kind=="StairShape" or u.kind=="DetailShape") and "Item" or u.kind
    local r=eventFor(eventName)
    if not r then error("Missing Place"..eventName) end
    if u.kind=="StairShape" or u.kind=="DetailShape" then
        r:FireServer(u.id,"Shapes",u.cf,u.color,u.material,1,u.size,u.lv)
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
        r:FireServer("Flat",u.x,u.z,u.sx,u.sz,0,0,0,state.color,state.material,nil,u.lv)
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
    local furniture=plot:FindFirstChild("Furniture")
    if furniture then
        for _,obj in ipairs(furniture:GetChildren()) do snapshot[obj]=true end
    end
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
        if accepted then
            stairTest.passed=true
            stairTest.signature=buildSignature(plot,origin)
            stairTest.itemId=target.id
            stairTest.first=target
            build.status="Stair tread verified; stair construction ready"
            notify("Stair shape placed and confirmed. Stair construction enabled.")
        else
            stairTest.passed=false
            build.status="Stair test not confirmed; auto stair requests remain disabled"
            notify(fired and build.status or ("Stair test failed: "..tostring(err):sub(1,85)))
        end
        refreshBuildStatus()
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end

local function startBuild()
    if build.busy then notify("A build is already running");return end
    local units,plot,origin,stats=buildPlan()
    if not units or not plot then notify("No owned plot detected; build stopped");return end
    if not build.passed or build.signature~=buildSignature(plot,origin) then
        build.passed=false
        notify("TEST ONE WALL first for this design and storey count")
        return
    end
    if not stairCatalog.scanned or not stairCatalog.wall then
        notify("Solid wall style unavailable; stopping to prevent all-glass build")
        return
    end
    -- Multi-storey shells are allowed. An accepted real Shapes tread unlocks
    -- the preview-derived staircase. Prefabricated stair sets are only catalogued
    -- until their actual dimensions and placement can be checked in-game.
    if state.floors>1 and stairTest.passed and
        stairTest.signature==buildSignature(plot,origin) and stairTest.itemId==
            (stairCatalog.shape and stairCatalog.shape.id) then
        local stairUnits=rawStairUnits(plot,origin)
        local added=0
        for _,u in ipairs(stairUnits) do
            if not sameStairUnit(u,stairTest.first) and not stairsAlreadyPresent(plot,u) then
                units[#units+1]=u
                added=added+1
            end
        end
        notify("Stair builder: "..added.." custom stair treads queued")
    elseif state.floors>1 then
        notify("Stair shapes not verified; continuing shell without real stairs")
    end
    if #units>900 then notify("Blueprint exceeds 900-piece limit");return end
    notify("Occupancy scan: "..(stats and stats.skipped or 0)..
        " occupied skipped; "..(stats and stats.trimmed or 0).." walls trimmed.")
    if #units==0 then notify("All planned positions occupied; no work needed");return end
    for _,kind in ipairs({"Wall","Floor","Roof"}) do
        if not eventFor(kind) then notify("Place"..kind.." remote missing");return end
    end
    if stairTest.passed and not eventFor("Item") then
        notify("PlaceItem unavailable. Staircase shapes cannot be built.")
        return
    end
    local pace=BUILD_SPEEDS[state.buildSpeed] or BUILD_SPEEDS.Fast
    local selectedSpeed=state.buildSpeed
    build.busy=true;build.cancel=false
    build.total=#units
    build.sent=0
    build.status="Building ("..selectedSpeed..") 0 / "..build.total
    refreshBuildStatus()
    notify("Build started / "..selectedSpeed.." mode / "..build.total.." requests")
    task.spawn(function()
        local sent,failures,extraSkips=0,0,0
        local fresh=occupiedFromPlot(plot,origin)
        for i,u in ipairs(units) do
            if not alive or build.cancel then break end
            if i%pace.burst==1 then fresh=occupiedFromPlot(plot,origin) end
            local blocked=false
            if u.kind=="StairShape" then
                blocked=stairsAlreadyPresent(plot,u)
            elseif u.kind=="Wall" then
                blocked=#openWallSegments(u,fresh)==0
            else
                for _,other in ipairs(fresh) do
                    if surfaceOverlaps(u,other) then blocked=true;break end
                end
            end
            if blocked then
                extraSkips=extraSkips+1
            else
                local ok,err=pcall(function() fireUnit(u) end)
                if not ok then failures=failures+1;notify(tostring(err):sub(1,100));break end
                if u.kind~="StairShape" then fresh[#fresh+1]=u end
                sent=sent+1
                build.sent=sent
                if i%12==0 or i==#units then
                    build.status="Building ("..selectedSpeed..") "..i.." / "..build.total..
                        " / already occupied "..extraSkips
                    refreshBuildStatus()
                end
                local rest=(sent%pace.burst==0) and pace.cooldown or 0
                task.wait(pace.interval+rest)
            end
        end
        build.busy=false
        build.passed=false
        build.testUnit=nil
        if build.cancel then
            build.status="Stopped after "..sent.." requests"
        elseif failures>0 then
            build.status="Stopped due to local placement error"
        else
            build.status="Submitted "..sent.." requests; skipped "..extraSkips.." occupied"
        end
        refreshBuildStatus()
        notify(build.status..". The game may still reject some requests; no retry loop.")
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
    Size=UDim2.new(1,-90,0,250), BackgroundColor3=C.raised,
    BorderSizePixel=0,ZIndex=26
},overlay),14)
border(dialog,C.purple,1.5,0.1)
local dialogTitle=text(dialog,"",22,19,420,32,20,C.white,true,{ZIndex=27,Size=UDim2.new(1,-44,0,32)})
local dialogBody=text(dialog,"",22,59,410,108,13,C.dim,false,{
    ZIndex=27,TextWrapped=true,TextYAlignment=Enum.TextYAlignment.Top,
    TextTruncate=Enum.TextTruncate.None, Size=UDim2.new(1,-44,0,108)
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
dialogClose.Position=UDim2.new(.05,0,0,190)
dialogClose.Size=UDim2.new(.42,0,0,34)
local cancelDialog=button(dialog,"CANCEL",0,190,95,34,false,function()
    dialogAction=nil
    overlay.Visible=false
end)
cancelDialog.ZIndex=27
cancelDialog.Position=UDim2.new(.53,0,0,190)
cancelDialog.Size=UDim2.new(.42,0,0,34)
modal = function(title,body,confirmText,callback)
    dialogTitle.Text=title
    dialogBody.Text=body
    dialogAction=callback
    dialogClose.Text=confirmText or "GOT IT"
    overlay.Visible=true
end

local function updateSidebar()
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

        local metrics=block(scroll,83)
        local values={{"31","MATERIALS"},{"5","STOREYS PLANNED"},{"3","PLACE REMOTES"}}
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
        text(opts,"MAX 5  •  DEMO ONLY",16,132,240,18,10,C.muted,true)

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
        text(speedBox,"Fast: ~0.08s/request  ·  Turbo: ~0.045s/request  ·  Server limits may apply",16,82,470,29,10,C.dim,false,{
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

        local action=block(scroll,174,C.raised)
        text(action,"ORNATE BLUEPRINT PREVIEW",16,10,380,24,15,C.mint,true)
        text(action,"Castle-scale structure with curated materials, stairwells and custom steps. Show Castle creates a safe local preview.",16,38,430,36,12,C.dim,false,{
            Size=UDim2.new(1,-32,0,36),TextWrapped=true
        })
        button(action,"SHOW CASTLE",16,88,147,32,true,beginPreview)
        button(action,"CLEAR PREVIEW",171,88,143,32,false,function() clearPreview(false) end)
        text(action,"SIZE: "..lastFootprint,16,131,440,23,10,C.mint,false,{
            Size=UDim2.new(1,-32,0,23)
        })


        local stairsBox=block(scroll,191,C.raised)
        text(stairsBox,"AUTO STAIRCASE SYSTEM",16,11,420,24,15,C.white,true)
        text(stairsBox,"The studio designs a staircase to fit the floor openings, then uses its Shapes catalog to build stone treads and landings.",16,37,420,48,11,C.dim,false,{
            Size=UDim2.new(1,-32,0,45),TextWrapped=true
        })
        local status=stairTest.passed and ("VERIFIED / "..tostring(stairCatalog.shape and stairCatalog.shape.name or "Shape")) or stairStatus
        text(stairsBox,status,16,84,425,22,11,stairTest.passed and C.mint or C.orange,true,{
            Size=UDim2.new(1,-32,0,22)
        })
        button(stairsBox,"SCAN STAIRS",16,118,139,32,false,function()
            task.spawn(function()
                scanStairs()
                if alive then switchPage("Builder") end
            end)
        end)
        button(stairsBox,"TEST STAIR TREAD",161,118,182,32,stairTest.passed,function()
            modal("Test one actual staircase tread?",
                "This uses the game's Shapes placement to put ONE real, custom-sized tread inside the planned stairwell. It may cost game currency and might be rejected. Only a confirmed tread will unlock the remaining stairs in the full build.",
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

        local builderPanel=block(scroll,194,C.raised)
        text(builderPanel,"BUILD THIS DESIGN",16,10,425,26,15,C.white,true)
        buildStatusText=text(builderPanel,build.status,16,37,435,23,11,C.mint,false,{Size=UDim2.new(1,-32,0,23)})
        text(builderPanel,"Multi-storey shell enabled. When TEST STAIR TREAD passes, custom stairs are queued too. Doors/windows remain preview-only.",16,63,435,47,12,C.dim,false,{
            Size=UDim2.new(1,-32,0,47),TextWrapped=true
        })
        button(builderPanel,"1. TEST ONE WALL",16,115,154,34,false,function()
            modal("Test one wall on your plot?",
                "You can build up to five storeys. Stairs and doors shown in previews aren't placed yet.\n\nFor a clean plot, back up existing work and bulldoze manually if desired. This may spend game currency.",
                "TEST ONE WALL",testWall)
        end)
        button(builderPanel,"2. START BUILD",176,115,160,34,build.passed,function()
            if not build.passed then modal("Test required","Press TEST ONE WALL and wait for a successful confirmation before starting the shell build.");return end
            modal("Build the selected castle?",
                "Permanent walls and floors will be submitted. A verified Shapes stair test enables additional real staircase treads; otherwise stairs remain a preview.\n\nDoors, windows and exterior ornamentation still need placement validation. Existing occupied items are skipped where detected. Game currency may be spent.",
                "BUILD CASTLE",startBuild)
        end)
        button(builderPanel,"STOP BUILD",16,156,128,26,false,stopBuild)
        local note=block(scroll,80)
        sectionNote(note,"STAIRS VIA CURATED SHAPES",
            "Scan the five stair sets and available blocks, then verify one custom tread. Unverified stair layouts are never batch-placed. STOP does not undo built pieces.",7)
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
        sectionNote(about,"PLOT STUDIO  •  VERSION 0.9",
            "Independent of Syndicate Hub. Local previews are harmless. Confirmed build actions can permanently place structures.",12)
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
print("[Plot Studio] v0.9 loaded. Preview is local; confirmed builder actions may place permanent structures.")
