--[[
    PLOT STUDIO | Storage Hunters
    Standalone GUI v0.3 with outlined previews and gated build
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
local renderPage, switchPage
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
local function beginPreview()
    clearPreview(true)
    local origin,where=previewFrame()
    if not origin then notify("No plot or player position for preview");return end
    local selected=designs[state.design]
    if not selected then return end
    local cfg
    pcall(function() cfg=require(game:GetService("ReplicatedStorage").Modules.PlotConfig) end)
    local storeyHeight=cfg and cfg.StoreyHeight or 15
    if typeof(storeyHeight)~="number" or storeyHeight<6 or storeyHeight>30 then storeyHeight=15 end
    local material=Enum.Material.Slate
    pcall(function()
        local candidate=Enum.Material[state.material]
        if candidate then material=candidate end
    end)
    previewFolder=Instance.new("Folder")
    previewFolder.Name=PREVIEW_NAME
    previewFolder.Parent=workspace
    local floors=math.min(state.floors,selected.floors)
    local w=state.design==5 and 22 or (state.design==2 and 48 or (state.design==4 and 38 or 56))
    local d=state.design==4 and 50 or w
    local count=0
    local function make(label,x,y,z,sx,sy,sz,rotation,shade)
        local p=Instance.new("Part")
        p.Name=label
        p.Anchored=true
        p.CanCollide=false;p.CanTouch=false;p.CanQuery=false
        p.CastShadow=false
        p.Material=material
        p.Color=shade or state.color
        p.Transparency=.74
        p.Size=Vector3.new(sx,sy,sz)
        p.CFrame=origin*CFrame.new(x,y,z)*CFrame.Angles(0,rotation or 0,0)
        p.Parent=previewFolder
        local edge=Instance.new("SelectionBox")
        edge.Name="BlueprintEdge"
        edge.Adornee=p
        edge.Color3=C.purple
        edge.LineThickness=.08
        edge.Transparency=0
        edge.SurfaceTransparency=1
        edge.Parent=p
        count=count+1
    end
    local function room(cx,cz,width,depth,level,door)
        local y=level*storeyHeight
        local h=storeyHeight
        if level>0 then make("Floor",cx,y-.25,cz,width,.5,depth) end
        make("Back wall",cx,y+h/2,cz+depth/2,width,h,.55)
        make("Left wall",cx-width/2,y+h/2,cz,depth,h,.55,math.pi/2)
        make("Right wall",cx+width/2,y+h/2,cz,depth,h,.55,math.pi/2)
        if door and level==0 and width>18 then
            local side=(width-12)/2
            make("Front wall L",cx-width/2+side/2,y+h/2,cz-depth/2,side,h,.55)
            make("Front wall R",cx+width/2-side/2,y+h/2,cz-depth/2,side,h,.55)
        else
            make("Front wall",cx,y+h/2,cz-depth/2,width,h,.55)
        end
    end
    for level=0,floors-1 do
        if state.design==3 then
            room(-21,0,22,44,level,true)
            room(21,0,22,44,level,true)
            if level>0 then make("Skybridge",0,level*storeyHeight-.25,0,22,.5,9) end
        else
            room(0,0,w,d,level,true)
        end
    end
    if state.design==1 or state.design==2 then
        local tw=state.design==1 and 13 or 11
        for _,sx in ipairs({-1,1}) do
            for _,sz in ipairs({-1,1}) do
                local x,z=sx*w/2,sz*d/2
                for level=0,floors-1 do room(x,z,tw,tw,level,false) end
                make("Tower roof",x,floors*storeyHeight-.25,z,tw+1,.5,tw+1)
            end
        end
    end
    if state.design==3 then
        make("West roof",-21,floors*storeyHeight-.25,0,24,.5,46)
        make("East roof",21,floors*storeyHeight-.25,0,24,.5,46)
    else
        make("Roof",0,floors*storeyHeight-.25,0,w+.7,.5,d+.7)
    end
    notify("Outlines: "..selected.name.." / "..count.." parts / "..where)
end


-- Build engine v0.3. The first real action is always a one-wall test.
local build={busy=false,cancel=false,passed=false,signature=nil,firstIndex=nil,status="Not started"}
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
        if p:IsA("BasePart") then
            local name=p.Name
            if name=="Floor" or name=="Skybridge" then
                local lv=math.clamp(math.floor((p.Position.Y-origin.Position.Y+.55)/h+.1),0,4)
                local nx,nz=math.ceil(p.Size.X/40),math.ceil(p.Size.Z/40)
                for ix=1,nx do for iz=1,nz do
                    local sx,sz=p.Size.X/nx,p.Size.Z/nz
                    local cf=p.CFrame*CFrame.new((ix-.5)*sx-p.Size.X/2,0,(iz-.5)*sz-p.Size.Z/2)
                    units[#units+1]={kind="Floor",cf=cf,sx=sx,sz=sz,lv=lv}
                end end
            elseif name:find("roof") or name:find("Roof") then
                local lv=math.clamp(math.floor((p.Position.Y-origin.Position.Y+.4)/h+.1)-1,0,4)
                local cf=origin:ToObjectSpace(p.CFrame)
                local nx,nz=math.ceil(p.Size.X/40),math.ceil(p.Size.Z/40)
                for ix=1,nx do for iz=1,nz do
                    local sx,sz=p.Size.X/nx,p.Size.Z/nz
                    local c=cf*CFrame.new((ix-.5)*sx-p.Size.X/2,0,(iz-.5)*sz-p.Size.Z/2)
                    units[#units+1]={kind="Roof",x=c.Position.X,z=c.Position.Z,sx=sx,sz=sz,lv=lv}
                end end
            else
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
    if #units>400 then notify("Blueprint exceeds 400-piece limit");return end
    for _,kind in ipairs({"Wall","Floor","Roof"}) do
        if not eventFor(kind) then notify("Place"..kind.." remote missing");return end
    end
    build.busy=true;build.cancel=false
    build.status="Building..."
    task.spawn(function()
        local sent=0;local failures=0
        for i,u in ipairs(units) do
            if build.cancel or not alive then break end
            if i~=build.firstIndex then
                local ok,err=pcall(function() fireUnit(u) end)
                if not ok then failures=failures+1;notify(tostring(err):sub(1,100));break end
                sent=sent+1
                if sent%10==0 then
                    build.status="Submitted "..sent.." / "..(#units-1)
                    notify(build.status)
                end
                task.wait(.35)
            end
        end
        build.busy=false;build.passed=false
        if build.cancel then build.status="Stopped after "..sent.." sends"
        elseif failures>0 then build.status="Stopped: placement error"
        else build.status="Sent "..sent.." requests; inspect plot" end
        notify(build.status..". Existing placed pieces remain.")
        if alive and state.page=="Builder" then switchPage("Builder") end
    end)
end
local function stopBuild()
    if build.busy then build.cancel=true;notify("Stopping remaining build requests")
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
local function modal(title,body,confirmText,callback)
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

        local choice=block(scroll,111)
        sectionNote(choice,"BUILD FINISH",
            "Material: "..state.material.."     /     Accent: "..state.colorName,10)
        button(choice,"CHOOSE MATERIAL",16,76,165,28,false,function() switchPage("Materials") end)

        local action=block(scroll,143,C.raised)
        text(action,"BLUEPRINT OUTLINES",16,10,380,24,15,C.mint,true)
        text(action,"Client-only outlines, visible even if your plot owner marker is missing. No pieces are purchased.",16,38,430,36,12,C.dim,false,{
            Size=UDim2.new(1,-32,0,36),TextWrapped=true
        })
        button(action,"SHOW OUTLINES",16,86,147,32,true,beginPreview)
        button(action,"CLEAR OUTLINES",171,86,143,32,false,function() clearPreview(false) end)

        local builderPanel=block(scroll,194,C.raised)
        text(builderPanel,"BUILD THIS DESIGN",16,10,425,26,15,C.white,true)
        text(builderPanel,build.status,16,37,435,23,11,C.mint,false,{Size=UDim2.new(1,-32,0,23)})
        text(builderPanel,"First confirm one wall can be placed. Then continue the experimental shell build (walls, floors, flat roofs).",16,63,435,47,12,C.dim,false,{
            Size=UDim2.new(1,-32,0,47),TextWrapped=true
        })
        button(builderPanel,"1. TEST ONE WALL",16,115,154,34,false,function()
            modal("Place one real wall?","This sends one real wall placement to your owned plot and may spend in-game money. It does not automatically retry if the server doesn't confirm the wall.","PLACE TEST",testWall)
        end)
        button(builderPanel,"2. START BUILD",176,115,160,34,build.passed,function()
            if not build.passed then modal("Test required","Press TEST ONE WALL and wait for a successful confirmation before starting the shell build.");return end
            modal("Start experimental shell?","This can send many permanent placements and spend in-game money. Designs are basic shells only, without stairs, doors or windows. You may need to clean up failed or overlapping pieces manually.","START BUILD",startBuild)
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
        sectionNote(about,"PLOT STUDIO  •  VERSION 0.3",
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
print("[Plot Studio] v0.3 loaded. Preview is local; confirmed builder actions may place permanent structures.")
