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
    buildSpeed = "Fast",
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
    local primary=state.color
    local stone=Color3.fromRGB(174,167,194):Lerp(primary,.32)
    local light=Color3.fromRGB(225,220,233):Lerp(primary,.22)
    local dark=Color3.fromRGB(53,54,78):Lerp(primary,.23)
    local gold=Color3.fromRGB(229,178,100)
    local glass=Color3.fromRGB(85,174,221)
    local roof=Color3.fromRGB(80,55,111)
    local mat=Enum.Material.Slate
    pcall(function() mat=Enum.Material[state.material] or mat end)
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
        p.CanTouch=false;p.CastShadow=false;p.Material=kind=="Glass" and Enum.Material.Glass or mat
        p.Color=color or stone
        p.Transparency=kind=="Glass" and .32 or (kind=="Decor" and .42 or .72)
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
        if entry and lv==0 then
            local open=math.min(wx*.29,19)
            local chunk=(wx-open)/2
            for _,sign in ipairs({-1,1}) do
                wall("Entrance masonry",cx+sign*(open+chunk)/2,cy,cz-dz/2,chunk,h,0,col)
            end
            wall("Gate arch",cx,lv*h+h*.88,cz-dz/2,open,h*.22,0,light)
            deco("Portcullis lintel",cx,lv*h+h*.58,cz-dz/2-1,open*.9,.65,1,gold)
            for i=-3,3 do
                deco("Iron gate rod",cx+i*open/8,lv*h+h*.35,cz-dz/2-1,.52,h*.65,.5,gold)
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
            walls(0,kz,kw,kd,lv,majestic and stone or dark,lv==0)
            if lv>0 then deck("Floor",0,lv*h-.3,kz,kw-2,kd-2,stone) end
            deco("Carved floor cornice",0,(lv+1)*h-.35,kz,kw+1,1.2,kd+1,light)
        end
        deck("Roof terrace",0,floors*h-.3,kz,kw+1,kd+1,dark)
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
                if lv>0 then deck("Floor",x,lv*h-.3,d*.06,wingW,wingD,stone) end
            end
            deck("Roof terrace",x,floors*h-.3,d*.06,wingW+2,wingD+2,stone)
            columns(x,-d*.31,wingW,"X")
            for _,z in ipairs({-d*.21,d*.27}) do tower(x,z,math.min(wingW*.23,10),floors+1,true) end
        end
        for lv=0,floors-1 do
            walls(0,d*.3,w*.43,d*.22,lv,stone,lv==0)
            if lv>0 then deck("Floor",0,lv*h-.3,d*.3,w*.43,d*.22,light) end
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
            if lv>0 then deck("Floor",0,lv*h-.3,0,wx,dz,stone) end
            openings(0,dz/2,wx,math.max(1,lv),0)
        end
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
            if lv>0 then deck("Floor",0,lv*h-.3,0,size,size,stone) end
        end
        deck("Roof terrace",0,floors*h-.3,0,size+3,size+3,light)
        tower(0,0,math.min(size*.24,13),floors+4,true)
        for _,x in ipairs({-w*.36,w*.36}) do
            tower(x,d*.27,math.min(w*.073,9),floors+1,false)
            deco("Suspended skybridge",x*.5,h*.9,d*.15,math.abs(x),1.2,6,light)
        end
        crenels(0,-size/2,size,floors*h+1,0)
    end
    notify("ORNATE PREVIEW: "..count.." parts / "..lastFootprint)
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
                    units[#units+1]={kind="Floor",cf=cf,sx=sx,sz=sz,lv=lv}
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
                    units[#units+1]={kind="Wall",a=a,b=b,lv=lv}
                end
            end
        end
    end
    local priority={Floor=1,Wall=2,Roof=3}
    table.sort(units,function(x,y)
        if x.lv~=y.lv then return x.lv<y.lv end
        return priority[x.kind]<priority[y.kind]
    end)
    return units,plot,origin
end
local function eventFor(kind)
    local folder=game:GetService("ReplicatedStorage"):FindFirstChild("Events")
    folder=folder and folder:FindFirstChild("Plot")
    local event=folder and folder:FindFirstChild("Place"..kind)
    if event and event:IsA("RemoteEvent") then return event end
end
local function fireUnit(u)
    local r=eventFor(u.kind)
    if not r then error("Missing Place"..u.kind) end
    if u.kind=="Wall" then
        local diff=u.b-u.a
        r:FireServer("5","Walls",u.a,u.b,Vector3.new(diff.X,0,diff.Z).Magnitude,
            math.atan2(-diff.Z,diff.X),u.a.Y,nil,nil,nil,u.lv)
    elseif u.kind=="Floor" then
        r:FireServer("32","Floors",u.cf,u.sx,u.sz,nil,nil,u.lv)
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
    clearPreview(true)
    local units,plot,origin=buildPlan()
    if not units then notify("Could not generate a build plan");return end
    local index
    for i,u in ipairs(units) do if u.kind=="Wall" then index=i;break end end
    if not index or not eventFor("Wall") then notify("Wall event not ready");return end
    build.signature=buildSignature(plot,origin)
    build.passed=false;build.firstIndex=index;build.cancel=false;build.busy=true
    build.status="Testing one wall"
    refreshBuildStatus()
    local before={}
    local folder=plot:FindFirstChild("Structures")
    if folder then for _,child in ipairs(folder:GetChildren()) do before[child]=true end end
    task.spawn(function()
        local ok,err=pcall(function() fireUnit(units[index]) end)
        local confirmed=false
        if ok then
            for _=1,25 do
                if not alive or build.cancel then break end
                if seeNewWall(plot,before) then confirmed=true;break end
                task.wait(.18)
            end
        end
        build.busy=false
        if confirmed then
            build.passed=true
            build.status="Wall test passed: ready to continue"
            notify("One wall placed! START BUILD is now available.")
        else
            build.status=ok and "Wall not confirmed; inspect your plot" or "Wall remote error"
            notify(build.status..(ok and "" or ": "..tostring(err):sub(1,90)))
        end
        refreshBuildStatus()
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end
local function startBuild()
    if build.busy then notify("A build is already running");return end
    local units,plot,origin=buildPlan()
    if not units or not plot then notify("No owned plot detected; build stopped");return end
    if not build.passed or build.signature~=buildSignature(plot,origin) then
        build.passed=false
        notify("TEST ONE WALL first for this design and storey count")
        return
    end
    if #units>900 then notify("Blueprint shell exceeds placement limit");return end
    for _,kind in ipairs({"Wall","Floor","Roof"}) do
        if not eventFor(kind) then notify("Place"..kind.." remote missing");return end
    end
    local pace=BUILD_SPEEDS[state.buildSpeed] or BUILD_SPEEDS.Fast
    local selectedSpeed=state.buildSpeed
    build.busy=true;build.cancel=false
    build.total=math.max(0,#units-1)
    build.sent=0
    build.status="Building ("..selectedSpeed..") 0 / "..build.total
    refreshBuildStatus()
    notify("Build started / "..selectedSpeed.." mode / "..build.total.." requests")
    task.spawn(function()
        local sent=0
        local failures=0
        for i,u in ipairs(units) do
            if build.cancel or not alive then break end
            if i~=build.firstIndex then
                local ok,err=pcall(function() fireUnit(u) end)
                if not ok then
                    failures=failures+1
                    notify(tostring(err):sub(1,100))
                    break
                end
                sent=sent+1
                build.sent=sent
                -- Update the status in place without rebuilding the whole GUI.
                if sent%12==0 or sent==build.total then
                    build.status="Building ("..selectedSpeed..") "..sent.." / "..build.total
                    refreshBuildStatus()
                end
                -- A short rest after each burst keeps STOP BUILD responsive and
                -- avoids dumping hundreds of remotes into the server at once.
                local rest=(sent%pace.burst==0) and pace.cooldown or 0
                task.wait(pace.interval+rest)
            end
        end
        build.busy=false
        build.passed=false
        if build.cancel then build.status="Stopped after "..sent.." requests"
        elseif failures>0 then build.status="Stopped due to a placement error"
        else build.status="Sent "..sent.." requests; inspect your plot" end
        refreshBuildStatus()
        notify(build.status..". Already placed pieces remain.")
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

        local choice=block(scroll,111)
        sectionNote(choice,"BUILD FINISH",
            "Material: "..state.material.."     /     Accent: "..state.colorName,10)
        button(choice,"CHOOSE MATERIAL",16,76,165,28,false,function() switchPage("Materials") end)

        local action=block(scroll,174,C.raised)
        text(action,"ORNATE BLUEPRINT PREVIEW",16,10,380,24,15,C.mint,true)
        text(action,"Giant plot-scale architecture: spires, turrets, stained glass, battlements and gatehouses. Nothing is purchased.",16,38,430,36,12,C.dim,false,{
            Size=UDim2.new(1,-32,0,36),TextWrapped=true
        })
        button(action,"SHOW CASTLE",16,88,147,32,true,beginPreview)
        button(action,"CLEAR PREVIEW",171,88,143,32,false,function() clearPreview(false) end)
        text(action,"SIZE: "..lastFootprint,16,131,440,23,10,C.mint,false,{
            Size=UDim2.new(1,-32,0,23)
        })

        local builderPanel=block(scroll,194,C.raised)
        text(builderPanel,"BUILD THIS DESIGN",16,10,425,26,15,C.white,true)
        buildStatusText=text(builderPanel,build.status,16,37,435,23,11,C.mint,false,{Size=UDim2.new(1,-32,0,23)})
        text(builderPanel,"The build test supports only basic walls and floors. Decorative spires, arches and windows are visual concepts for now.",16,63,435,47,12,C.dim,false,{
            Size=UDim2.new(1,-32,0,47),TextWrapped=true
        })
        button(builderPanel,"1. TEST ONE WALL",16,115,154,34,false,function()
            modal("Place one real wall?","This sends one real wall placement to your owned plot and may spend in-game money. It does not automatically retry if the server doesn't confirm the wall.","PLACE TEST",testWall)
        end)
        button(builderPanel,"2. START BUILD",176,115,160,34,build.passed,function()
            if not build.passed then modal("Test required","Press TEST ONE WALL and wait for a successful confirmation before starting the shell build.");return end
            modal("Start experimental shell?","This can spend in-game money, placing only the basic walls and floors. Spires, battlements, arches, windows, stairs and furniture are preview-only. You may need to clean up failed or overlapping pieces manually.","START BUILD",startBuild)
        end)
        button(builderPanel,"STOP BUILD",16,156,128,26,false,stopBuild)
        local note=block(scroll,80)
        sectionNote(note,"TESTING STAGE / NOT A FINISHED CASTLE",
            "The preview is local; actual build placement depends on the game's server rules. STOP prevents further sends, but will not undo what was placed.",7)
    elseif page=="Materials" then
        pageHead(scroll,"Material palette","31 materials captured from the Storage Hunters editor.")
        local current=block(scroll,102,C.raised)
        text(current,"CURRENT FINISH",14,9,220,19,10,C.dim,true)
        text(current,state.material,14,30,350,28,19,C.white,true,{Size=UDim2.new(1,-82,0,28)})
        local chip=corner(ui("Frame",{
            AnchorPoint=Vector2.new(1,0),
            Position=UDim2.new(1,-17,0,17),Size=UDim2.fromOffset(48,48),
            BackgroundColor3=state.color,BorderSizePixel=0
        },current),11)
        border(chip,C.line,1,0.15)
        text(current,"Accent: "..state.colorName,14,67,340,19,11,C.dim,false,{
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
        settingsRow("Confirm before building","Safety confirmation for future builds","confirm")
        settingsRow("Grid and placement outlines","Future layout preview preference","grid")
        settingsRow("Toast notifications","Show in-studio messages","notifications")
        settingsRow("Compact navigation","Make more room for content","compact")
        local about=block(scroll,119,C.raised)
        sectionNote(about,"PLOT STUDIO  •  VERSION 0.5",
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
print("[Plot Studio] v0.5 loaded. Preview is local; confirmed builder actions may place permanent structures.")
