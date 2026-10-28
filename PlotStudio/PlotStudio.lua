--[[
  PLOT COPIER V3.2 | Storage Hunters
  Replaces the old Plot Studio interface (backed up in PlotStudio/Archive).
  Captures replicated builds as relative JSON blueprints.
  Local JSON: SyndicateHub/SavedBases/<name>.json
  Optional public GitHub library: SavedBases/index.json
  Paste is experimental, verifies each supported category, and never deletes items.
  Existing structures must be cleared by the owner before a fresh paste.
]]
local Players=game:GetService("Players")
local RS=game:GetService("ReplicatedStorage")
local Http=game:GetService("HttpService")
local UIS=game:GetService("UserInputService")
local CoreGui=game:GetService("CoreGui")
local player=Players.LocalPlayer
if not player then return end
local VERSION="3.2"
local GUI_NAME="Syndicate_PlotCopier"
local ENV=_G
pcall(function() if type(getgenv)=="function" then ENV=getgenv() end end)
local KEY="__SyndicatePlotCopier"
if type(ENV[KEY])=="function" then pcall(ENV[KEY]) end
-- Switching from the old Plot Studio should also close its old loops and GUI.
local oldShutdown=ENV["__StorageHunters_PlotStudio"]
if type(oldShutdown)=="function" then pcall(oldShutdown) end
for _,where in ipairs({CoreGui,player:WaitForChild("PlayerGui")}) do
    for _,guiName in ipairs({GUI_NAME,"StorageHunters_PlotStudio"}) do
        local prior=where:FindFirstChild(guiName)
        if prior then prior:Destroy() end
    end
end
local alive=true
local busy=false
local cancel=false
local conns={}
local current=nil
local selectedPlot=nil
local selectedBase=nil
local library={}
local armed=false
local logs={}
local folder="SyndicateHub/SavedBases"
local baseUrl="https://raw.githubusercontent.com/ThatOneThing91/Syndicate-Hub/main/SavedBases/"
local function log(msg)
    table.insert(logs,os.date("%H:%M:%S").." "..tostring(msg))
    if #logs>80 then table.remove(logs,1) end
    print("[Plot Copier] "..tostring(msg))
end
local function connect(sig,fn)
    local c=sig:Connect(fn)
    table.insert(conns,c)
    return c
end
local function make(typ,props,parent)
    local a=Instance.new(typ)
    for k,v in pairs(props or {}) do a[k]=v end
    a.Parent=parent
    return a
end
local function round(obj,r)
    make("UICorner",{CornerRadius=UDim.new(0,r or 8)},obj)
    return obj
end
local function stroke(obj)
    make("UIStroke",{Color=Color3.fromRGB(70,55,110),Thickness=1,Transparency=.25},obj)
    return obj
end
local COLORS={
    bg=Color3.fromRGB(13,13,23),side=Color3.fromRGB(24,23,39),
    raised=Color3.fromRGB(35,32,52),purple=Color3.fromRGB(162,109,255),
    ink=Color3.fromRGB(241,237,255),dim=Color3.fromRGB(164,160,188),
    green=Color3.fromRGB(119,219,169),red=Color3.fromRGB(248,117,143)
}
local GUI=make("ScreenGui",{Name=GUI_NAME,ResetOnSpawn=false,
    ZIndexBehavior=Enum.ZIndexBehavior.Sibling,DisplayOrder=10030,
    IgnoreGuiInset=true},nil)
local guiSet=false
if type(gethui)=="function" then
    guiSet=pcall(function() GUI.Parent=gethui() end) and GUI.Parent~=nil
end
if not guiSet then
    guiSet=pcall(function() GUI.Parent=CoreGui end) and GUI.Parent~=nil
end
if not guiSet then GUI.Parent=player:WaitForChild("PlayerGui") end
local viewport=workspace.CurrentCamera and workspace.CurrentCamera.ViewportSize or Vector2.new(1000,700)
local W=math.min(660,math.max(340,viewport.X-26))
local H=math.min(555,math.max(425,viewport.Y-34))
local win=round(make("Frame",{Name="Window",Size=UDim2.fromOffset(W,H),
    Position=UDim2.new(.5,-W/2,.5,-H/2),BackgroundColor3=COLORS.bg,
    BorderSizePixel=0,ClipsDescendants=true},GUI),12)
stroke(win)
local top=make("Frame",{BackgroundColor3=COLORS.side,BorderSizePixel=0,
    Size=UDim2.new(1,0,0,62)},win)
local function txt(parent,value,x,y,w,h,size,col,bold)
    return make("TextLabel",{BackgroundTransparency=1,Text=tostring(value),
        Position=UDim2.fromOffset(x,y),Size=UDim2.fromOffset(w,h),
        TextColor3=col or COLORS.ink,TextSize=size or 13,
        Font=bold and Enum.Font.GothamBold or Enum.Font.Gotham,
        TextXAlignment=Enum.TextXAlignment.Left,
        TextYAlignment=Enum.TextYAlignment.Center,
        TextTruncate=Enum.TextTruncate.AtEnd},parent)
end
txt(top,"PLOT COPIER",16,8,270,29,21,COLORS.ink,true)
txt(top,"V"..VERSION.."  •  STORAGE HUNTERS  /  SAVED BASES",18,36,430,17,10,COLORS.purple,true)
local function btn(parent,title,x,y,w,h,handler,primary)
    local b=round(make("TextButton",{Text=title,TextSize=12,
        Font=Enum.Font.GothamBold,TextColor3=primary and COLORS.bg or COLORS.ink,
        BackgroundColor3=primary and COLORS.purple or COLORS.raised,
        BorderSizePixel=0,Size=UDim2.fromOffset(w,h),
        Position=UDim2.fromOffset(x,y),AutoButtonColor=true},parent),7)
    if handler then connect(b.Activated,function()
        if alive then
            local ok,err=pcall(handler)
            if not ok then log("UI error: "..tostring(err)) end
        end
    end) end
    return b
end
local status=txt(win,"Select a plot on the left, then COPY PLOT.",16,H-51,W-32,18,12,COLORS.dim,false)
local detail=txt(win,"",16,H-31,W-32,15,10,COLORS.dim,false)
local function inform(message,isError)
    log(message)
    if status and status.Parent then
        status.Text=message
        status.TextColor3=isError and COLORS.red or COLORS.green
    end
end
local minimized=false
local bubble=round(make("TextButton",{Text="◈",Visible=false,
    Size=UDim2.fromOffset(48,48),Position=UDim2.new(0,16,0,90),
    BackgroundColor3=COLORS.purple,TextColor3=COLORS.bg,
    TextSize=27,Font=Enum.Font.GothamBold,BorderSizePixel=0},GUI),24)
local function shutdown()
    if not alive then return end
    alive=false; cancel=true
    for _,c in ipairs(conns) do pcall(function() c:Disconnect() end) end
    GUI:Destroy()
    ENV[KEY]=nil
end
ENV[KEY]=shutdown
btn(top,"—",W-88,15,32,32,function()
    minimized=true
    win.Visible=false
    bubble.Visible=true
end)
btn(top,"×",W-47,15,32,32,shutdown)
connect(bubble.Activated,function()
    minimized=false
    bubble.Visible=false
    win.Visible=true
end)
local dragStart,original,dragging
connect(top.InputBegan,function(i)
    if i.UserInputType==Enum.UserInputType.MouseButton1 or
        i.UserInputType==Enum.UserInputType.Touch then
        dragging=true; dragStart=i.Position;original=win.Position
    end
end)
connect(top.InputEnded,function(i)
    if i.UserInputType==Enum.UserInputType.MouseButton1 or
        i.UserInputType==Enum.UserInputType.Touch then dragging=false end
end)
connect(UIS.InputChanged,function(i)
    if dragging and (i.UserInputType==Enum.UserInputType.MouseMovement
        or i.UserInputType==Enum.UserInputType.Touch) then
        local d=i.Position-dragStart
        win.Position=UDim2.new(original.X.Scale,original.X.Offset+d.X,
            original.Y.Scale,original.Y.Offset+d.Y)
    end
end)
-- Resolve the actual active Player instead of displaying a hard-coded "(PLAYER)".
-- The game has used OwnerUserId, owner attributes, and
-- OwnerHeadshot.OwnerName (TextLabel/StringValue) in different layouts.
-- Only claim someone is active when they exist in Players.
local function ownerInfo(plot)
    local names,ids={},{}
    local function observe(value)
        if typeof(value)=="Instance" then
            if value:IsA("Player") then
                ids[#ids+1]=value.UserId
                names[#names+1]=value.Name
            elseif value:IsA("ObjectValue") then
                observe(value.Value)
            elseif value:IsA("StringValue") then
                names[#names+1]=value.Value
            elseif value:IsA("IntValue") or value:IsA("NumberValue") then
                ids[#ids+1]=value.Value
            elseif value:IsA("TextLabel") or value:IsA("TextButton")
                or value:IsA("TextBox") then
                names[#names+1]=value.Text
            end
        elseif type(value)=="number" and value>0 then
            ids[#ids+1]=value
        elseif type(value)=="string" and value~="" then
            names[#names+1]=value
        end
    end
    for _,key in ipairs({"OwnerUserId","OwnerId","OwnerID",
        "PlayerUserId","UserId"}) do
        observe(plot:GetAttribute(key))
    end
    for _,key in ipairs({"OwnerUsername","OwnerName","Owner",
        "PlayerName","Username","OwnedBy"}) do
        observe(plot:GetAttribute(key))
    end
    for _,key in ipairs({"Owner","OwnerPlayer","Player","OwnerName",
        "OwnerUserId","OwnerUsername"}) do
        local child=plot:FindFirstChild(key)
        if child then observe(child) end
    end
    local sign=plot:FindFirstChild("OwnerHeadshot",true)
    if sign then
        for _,key in ipairs({"OwnerName","OwnerUsername","Username",
            "PlayerName","OwnerUserId"}) do
            local child=sign:FindFirstChild(key,true)
            if child then observe(child) end
        end
    end
    -- Numeric IDs take priority, including numeric strings stored in labels.
    for _,id in ipairs(ids) do
        local p=Players:GetPlayerByUserId(tonumber(id) or 0)
        if p then return p,nil end
    end
    local people=Players:GetPlayers()
    local candidate
    for _,raw in ipairs(names) do
        local value=tostring(raw):match("^%s*(.-)%s*$")
        local handle=value:match("@([%w_]+)")
        local norm=(handle or value):lower()
        local number=tonumber(norm)
        if number then
            local byId=Players:GetPlayerByUserId(number)
            if byId then return byId,nil end
        end
        if norm~="" and norm~="player" and norm~="none" and
            norm~="unclaimed" and norm~="nobody" and norm~="empty" and
            norm~="no owner" and norm~="available" then
            candidate=candidate or (handle or value)
            -- Match true account usernames first. DisplayNames can repeat,
            -- so only use them when they are uniquely matched in this server.
            for _,p in ipairs(people) do
                if p.Name:lower()==norm then return p,nil end
            end
            local match,matches=nil,0
            for _,p in ipairs(people) do
                if p.DisplayName:lower()==norm then
                    match=p;matches=matches+1
                end
            end
            if matches==1 then return match,nil end
        end
    end
    return nil,candidate
end
local function plotOwner(plot)
    local owner=ownerInfo(plot)
    return owner==player
end
local function plotOwnerLabel(plot)
    local owner,unverified=ownerInfo(plot)
    if owner==player then return "@"..owner.Name.." (YOU)" end
    if owner then return "@"..owner.Name end
    if unverified then return tostring(unverified).." (unverified)" end
    return "NO OWNER SHOWN"
end
local function plotFrame(plot)
    if not plot then return nil end
    local x,y,z=plot:GetAttribute("OriginX"),plot:GetAttribute("OriginY"),plot:GetAttribute("OriginZ")
    local base=plot:FindFirstChild("Base")
    local floorPart=base and base:FindFirstChild("Floor")
    if type(x)=="number" and type(y)=="number" and type(z)=="number" then
        local sy=plot:GetAttribute("SizeY")
        if type(sy)=="number" then y=y+sy/2
        elseif floorPart and floorPart:IsA("BasePart") then
            y=floorPart.Position.Y+floorPart.Size.Y/2 end
        return CFrame.new(x,y,z)*CFrame.Angles(0,math.rad(plot:GetAttribute("RotationY") or 0),0)
    end
    if floorPart and floorPart:IsA("BasePart") then
        return CFrame.new(floorPart.Position+Vector3.new(0,floorPart.Size.Y/2,0))*
            (floorPart.CFrame-floorPart.CFrame.Position)
    end
end
local function plots()
    local f=workspace:FindFirstChild("_Plots")
    local a=f and f:GetChildren() or {}
    table.sort(a,function(x,y)return x.Name<y.Name end)
    return a
end
local function ownPlot()
    for _,p in ipairs(plots()) do
        if plotOwner(p) then return p end
    end
end
local function getSelectedPlot()
    for _,p in ipairs(plots()) do
        if p.Name==selectedPlot then return p end
    end
end
local function getStoreyHeight()
    local h=15
    pcall(function()
        local cfg=require(RS.Modules.PlotConfig)
        if type(cfg.StoreyHeight)=="number" then h=cfg.StoreyHeight end
    end)
    return math.clamp(h,6,30)
end
local unpackArgs=table.unpack or unpack
local function packCf(cf)
    return {cf:GetComponents()}
end
local function unpackCf(a)
    if type(a)~="table" or #a~=12 then return nil end
    for _,n in ipairs(a) do
        if type(n)~="number" or n~=n or math.abs(n)>10000000 then return nil end
    end
    return CFrame.new(unpackArgs(a))
end
local function safeName(n)
    return tostring(n or "Base"):gsub("[^%w_%-%s]",""):gsub("%s+","_"):sub(1,58)
end
local function hasFileAPI()
    return type(writefile)=="function" and type(readfile)=="function" and
        type(listfiles)=="function"
end
local function ensureFolder()
    if type(makefolder)~="function" then return end
    pcall(makefolder,"SyndicateHub")
    pcall(makefolder,folder)
end
local function getBPfromText(source)
    local ok,data=pcall(function() return Http:JSONDecode(source) end)
    if not ok or type(data)~="table" or data.format~="plotcopier-1"
        or type(data.parts)~="table" or #data.parts>12000 then
        return nil,"Invalid Plot Copier JSON"
    end
    return data
end
local function capture(plot)
    local origin=plotFrame(plot)
    if not origin then return nil,"Could not read this plot's origin" end
    local bp={format="plotcopier-1",version=1,
        name=plot.Name.."_"..os.date("%Y%m%d_%H%M"),
        creator=(function()
            local owner,raw=ownerInfo(plot)
            return owner and owner.Name or raw or "Unknown"
        end)(),
        sourcePlot=plot.Name,created=os.time(),storeyHeight=getStoreyHeight(),parts={}}
    local seen={}
    local ignored=0
    for _,rootName in ipairs({"Structures","Floors","Roofs","Furniture","Shapes","Decorations"}) do
        local root=plot:FindFirstChild(rootName)
        if root then
            for _,object in ipairs(root:GetDescendants()) do
                if #bp.parts>=5000 then break end
                local isModel=object:IsA("Model")
                local isPart=object:IsA("BasePart")
                local ancestor=object:FindFirstAncestorOfClass("Model")
                local outermost=isModel and (not ancestor or not ancestor:IsDescendantOf(root))
                local standalone=isPart and (not ancestor or not ancestor:IsDescendantOf(root))
                if (outermost or standalone) and not seen[object] then
                    seen[object]=true
                    local id=object:GetAttribute("ItemId")
                    local cat=tostring(object:GetAttribute("Category") or
                        object:GetAttribute("ItemCategory") or rootName)
                    local level=object:GetAttribute("Storey")
                    local wallCf=object:GetAttribute("WallCFrame")
                    local wallLen=object:GetAttribute("WallLength")
                    local kind
                    if typeof(wallCf)=="CFrame" and type(wallLen)=="number" and wallLen>1 then
                        kind="Wall"
                    elseif cat=="Floors" or tostring(id or "")=="32" or
                        (rootName=="Floors") then
                        kind="Floor"
                    elseif cat=="Roofs" or rootName=="Roofs" or
                        object:GetAttribute("RoofStyle")~=nil then
                        kind="Roof"
                    elseif id~=nil then
                        kind="Item"
                    end
                    if kind then
                        local ok,cf,size=pcall(function()
                            if object:IsA("BasePart") then return object.CFrame,object.Size end
                            return object:GetBoundingBox()
                        end)
                        if ok and typeof(cf)=="CFrame" and typeof(size)=="Vector3" then
                            local effectiveCf=kind=="Wall" and wallCf or cf
                            if kind=="Item" and object:IsA("Model") then
                                local pivotOk,pivot=pcall(function() return object:GetPivot() end)
                                if pivotOk then effectiveCf=pivot end
                            end
                            local lv=type(level)=="number" and level or
                                math.floor((effectiveCf.Position.Y-origin.Position.Y)/bp.storeyHeight+.1)
                            lv=math.clamp(math.floor(lv),0,4)
                            local row={kind=kind,id=id~=nil and tostring(id) or nil,
                                category=cat,lv=lv,name=object.Name,
                                cf=packCf(origin:ToObjectSpace(effectiveCf)),
                                size={size.X,size.Y,size.Z}}
                            if kind=="Wall" then row.length=wallLen end
                            if kind=="Roof" then row.style=object:GetAttribute("RoofStyle") end
                            bp.parts[#bp.parts+1]=row
                        else ignored=ignored+1 end
                    else ignored=ignored+1 end
                end
            end
        end
    end
    if #bp.parts==0 then return nil,"No supported structures visible; plot may not have streamed in" end
    return bp,ignored
end
local function canPlace(part)
    if part.kind=="Wall" then return part.id~=nil end
    if part.kind=="Floor" then return true end
    if part.kind=="Item" then
        return part.id~=nil and
            (part.category=="Shapes" or part.category=="Doors")
    end
    return false
end
local function stat(bp)
    local counts={Wall=0,Floor=0,Item=0,Roof=0}
    local supported=0
    for _,p in ipairs(bp.parts or {}) do
        counts[p.kind]=(counts[p.kind] or 0)+1
        if canPlace(p) then supported=supported+1 end
    end
    return counts,supported
end
local panelW=math.floor((W-44)/2)
local panelY=91
local panelH=math.max(153,H-297)
local left=round(make("Frame",{Position=UDim2.fromOffset(14,panelY),
    Size=UDim2.fromOffset(panelW,panelH),BackgroundColor3=COLORS.side,
    BorderSizePixel=0},win),9)
local right=round(make("Frame",{Position=UDim2.fromOffset(30+panelW,panelY),
    Size=UDim2.fromOffset(panelW,panelH),BackgroundColor3=COLORS.side,
    BorderSizePixel=0},win),9)
txt(left,"VISIBLE PLOTS",10,8,panelW-20,22,12,COLORS.ink,true)
txt(right,"SAVED BASES",10,8,panelW-20,22,12,COLORS.ink,true)
local function scroll(parent)
    local f=make("ScrollingFrame",{Position=UDim2.fromOffset(6,33),
        Size=UDim2.new(1,-12,1,-39),BackgroundTransparency=1,BorderSizePixel=0,
        ScrollBarThickness=4,CanvasSize=UDim2.fromOffset(0,0)},parent)
    return f
end
local leftScroll,rightScroll=scroll(left),scroll(right)
local function fillScroll(scrollObj,rows,selected,clicked)
    for _,child in ipairs(scrollObj:GetChildren()) do
        if child:IsA("TextButton") then child:Destroy() end
    end
    for i,row in ipairs(rows) do
        local b=round(make("TextButton",{Text="  "..row.label,TextSize=11,
            TextXAlignment=Enum.TextXAlignment.Left,Font=Enum.Font.Gotham,
            TextTruncate=Enum.TextTruncate.AtEnd,
            TextColor3=COLORS.ink,BackgroundColor3=
                selected==row.id and COLORS.purple or COLORS.raised,
            BackgroundTransparency=selected==row.id and .18 or 0,
            Size=UDim2.new(1,-5,0,30),
            Position=UDim2.fromOffset(0,(i-1)*34),
            BorderSizePixel=0},scrollObj),6)
        -- Destroyed row buttons automatically disconnect these handlers.
        -- Do not retain a new global connection on every live refresh.
        b.Activated:Connect(function() clicked(row.id) end)
    end
    scrollObj.CanvasSize=UDim2.fromOffset(0,#rows*34+4)
end
local nameY=panelY+panelH+10
local nameEntry=round(make("TextBox",{Position=UDim2.fromOffset(14,nameY),
    Size=UDim2.fromOffset(W-28,31),Text="",PlaceholderText="Name this copied base",
    TextSize=13,TextColor3=COLORS.ink,
    PlaceholderColor3=COLORS.dim,BackgroundColor3=COLORS.raised,
    ClearTextOnFocus=false,Font=Enum.Font.Gotham,BorderSizePixel=0},win),7)
local buttonY=nameY+40
local bw=math.floor((W-46)/3)
local function action(slot,row,title,fn,primary)
    return btn(win,title,14+(slot-1)*(bw+9),buttonY+(row-1)*37,
        bw,31,fn,primary)
end
local function sortedLibrary()
    local a={}
    for id,item in pairs(library) do
        a[#a+1]={id=id,label=item.label}
    end
    table.sort(a,function(x,y)return x.label<y.label end)
    return a
end
local refresh
local plotListSignature=nil
local updatePlotRows
updatePlotRows=function(force)
    local rows={}
    local identity={}
    for _,p in ipairs(plots()) do
        local label=p.Name.."  •  "..plotOwnerLabel(p)
        rows[#rows+1]={id=p.Name,label=label}
        identity[#identity+1]=label
    end
    local signature=table.concat(identity,"|").."|selected:"..tostring(selectedPlot)
    if not force and signature==plotListSignature then return end
    plotListSignature=signature
    fillScroll(leftScroll,rows,selectedPlot,function(value)
        selectedPlot=value
        local plot=getSelectedPlot()
        if plot then
            inform("Selected "..plot.Name.." — "..plotOwnerLabel(plot))
        end
        updatePlotRows(true)
    end)
end
refresh=function()
    updatePlotRows(true)
    fillScroll(rightScroll,sortedLibrary(),selectedBase,function(value)
        selectedBase=value
        armed=false
        local item=library[value]
        if item and item.bp then
            current=item.bp
            nameEntry.Text=current.name or ""
        end
        refresh()
    end)
    if current then
        local counts,supported=stat(current)
        detail.Text=string.format("%d saved parts  |  %d supported for paste  |  W:%d F:%d I:%d R:%d",
            #current.parts,supported,counts.Wall,counts.Floor,counts.Item,counts.Roof)
    else
        detail.Text="Copy a visible plot to capture its structure."
    end
end
local function loadLocal()
    if type(listfiles)~="function" or type(readfile)~="function" then return end
    ensureFolder()
    local ok,items=pcall(listfiles,folder)
    if not ok or type(items)~="table" then return end
    for _,filePath in ipairs(items) do
        if type(filePath)=="string" and filePath:lower():match("%.json$") then
            local got,contents=pcall(readfile,filePath)
            if got then
                local bp=getBPfromText(contents)
                if bp then
                    local id="local:"..filePath
                    library[id]={label="💾 "..tostring(bp.name),bp=bp,path=filePath}
                end
            end
        end
    end
end
local function downloadLibrary()
    if busy then inform("Cannot refresh library during paste",true);return end
    inform("Reading SavedBases/index.json from GitHub...")
    task.spawn(function()
        local ok,data=pcall(function()
            return Http:JSONDecode(game:HttpGet(baseUrl.."index.json?v="..os.time()))
        end)
        if not alive then return end
        if not ok or type(data)~="table" then
            inform("GitHub index unavailable. Private repositories need public access.",true)
            return
        end
        local entries=data.bases or data
        if type(entries)~="table" then
            inform("GitHub index requires a 'bases' array",true);return
        end
        local discovered=0
        for _,entry in ipairs(entries) do
            if type(entry)=="table" and type(entry.file)=="string" and
                entry.file:match("^[%w_%.-]+%.json$") then
                local id="online:"..entry.file
                library[id]={label="☁ "..tostring(entry.name or entry.file),
                    remoteFile=entry.file}
                discovered=discovered+1
            end
        end
        refresh()
        inform("Online library: "..discovered.." entries listed")
    end)
end
local function chooseBase()
    if not selectedBase or not library[selectedBase] then return current end
    local entry=library[selectedBase]
    if entry.bp then return entry.bp end
    if entry.remoteFile then
        local ok,body=pcall(function()
            return game:HttpGet(baseUrl..entry.remoteFile.."?v="..os.time())
        end)
        if not ok then return nil,"Could not fetch public blueprint: "..entry.remoteFile end
        local bp,err=getBPfromText(body)
        if not bp then return nil,err end
        entry.bp=bp
        current=bp
        return bp
    end
    return current
end
local function saveCurrent()
    if not current then inform("Copy a plot or select a base first",true);return end
    local newName=nameEntry.Text
    if newName=="" then newName=current.name or "CopiedBase" end
    newName=safeName(newName)
    if newName=="" then inform("Choose a valid base name",true);return end
    current.name=newName
    local output=Http:JSONEncode(current)
    local file=folder.."/"..newName..".json"
    if hasFileAPI() then
        ensureFolder()
        local ok,err=pcall(writefile,file,output)
        if not ok then inform("JSON save failed: "..tostring(err),true);return end
        library["local:"..file]={label="💾 "..newName,bp=current,path=file}
        selectedBase="local:"..file
        inform("Saved "..newName.." to "..file)
    else
        library["memory:"..newName]={label="◉ "..newName.." (session only)",bp=current}
        selectedBase="memory:"..newName
        inform("No file APIs: saved for this session. Use COPY JSON to export.",true)
    end
    refresh()
end
local function copyJson()
    local bp,err=chooseBase()
    if not bp then inform(err or "Nothing to export",true);return end
    local payload=Http:JSONEncode(bp)
    local clip=setclipboard or toclipboard
    if type(clip)~="function" then
        print("PLOT COPIER JSON:\n"..payload)
        inform("Clipboard unavailable; JSON printed to executor console",true)
    else
        local ok=pcall(clip,payload)
        inform(ok and "Full blueprint JSON copied to clipboard" or
            "Could not copy JSON",not ok)
    end
end
local function readModels(plot)
    local models={}
    for _,rootName in ipairs({"Structures","Floors","Furniture","Shapes","Decorations","Roofs"}) do
        local root=plot:FindFirstChild(rootName)
        if root then
            for _,m in ipairs(root:GetChildren()) do
                if m:IsA("Model") or m:IsA("BasePart") then models[m]=true end
            end
        end
    end
    return models
end
local function newNearby(plot,previous,target,kind)
    for m in pairs(readModels(plot)) do
        if not previous[m] then
            local pos
            local ok=pcall(function()
                pos=m:IsA("BasePart") and m.Position or m:GetPivot().Position
            end)
            if ok and typeof(pos)=="Vector3" and (pos-target).Magnitude<
                (kind=="Wall" and 15 or 20) then
                if kind~="Wall" or typeof(m:GetAttribute("WallCFrame"))=="CFrame" then
                    return true
                end
            end
        end
    end
    return false
end
local function remote(name)
    local e=RS:FindFirstChild("Events")
    local p=e and e:FindFirstChild("Plot")
    local r=p and p:FindFirstChild("Place"..name)
    return r and r:IsA("RemoteEvent") and r or nil
end
local function placeOne(part,origin,storey)
    local cf=unpackCf(part.cf)
    if not cf then return false,"Invalid captured CFrame" end
    cf=origin*cf
    local lv=math.clamp(tonumber(part.lv) or 0,0,4)
    if part.kind=="Wall" then
        local r=remote("Wall")
        if not r then return false,"PlaceWall remote unavailable" end
        local length=tonumber(part.length)
        if not length or length<1 then return false,"Missing wall length" end
        local a=cf.Position-cf.RightVector*(length*.5)
        local b=cf.Position+cf.RightVector*(length*.5)
        local d=b-a
        -- The old Cobalt capture uses reference Y on the storey base.
        local refY=origin.Position.Y+lv*storey
        r:FireServer(part.id,"Walls",a,b,length,
            math.atan2(-d.Z,d.X),refY,nil,nil,nil,lv)
    elseif part.kind=="Floor" then
        local r=remote("Floor")
        if not r then return false,"PlaceFloor remote unavailable" end
        r:FireServer(part.id or "32","Floors",cf,
            tonumber(part.size and part.size[1]) or 4,
            tonumber(part.size and part.size[3]) or 4,nil,nil,lv)
    elseif part.kind=="Item" then
        local r=remote("Item")
        if not r then return false,"PlaceItem remote unavailable" end
        if part.category=="Shapes" then
            local size=part.size or {2,2,2}
            r:FireServer(part.id,"Shapes",cf,nil,nil,.25,
                Vector3.new(size[1],size[2],size[3]),lv)
        elseif part.category=="Doors" then
            r:FireServer(part.id,"Doors",cf,nil,nil,.25,nil,lv)
        else
            return false,"Unsupported item category"
        end
    else
        return false,"This object type has no validated placement signature"
    end
    return true,cf.Position
end
local pasteButton
local function paste()
    if busy then inform("Already building",true);return end
    local bp,err=chooseBase()
    if not bp then inform(err or "Select a saved base",true);return end
    local own=ownPlot()
    if not own then inform("Could not identify your owned plot",true);return end
    local origin=plotFrame(own)
    if not origin then inform("Could not read your plot origin",true);return end
    local existing=readModels(own)
    local count=0
    for _ in pairs(existing) do count=count+1 end
    if count>0 then
        inform("Paste blocked: your plot has "..count.." existing items. Clear it first.",true)
        return
    end
    if not armed then
        armed=true
        pasteButton.Text="CONFIRM PASTE"
        inform("Ready to paste "..tostring(bp.name)..". Press CONFIRM PASTE.")
        return
    end
    armed=false
    pasteButton.Text="PASTE TO MY PLOT"
    busy=true; cancel=false
    task.spawn(function()
        local confirmed,failed,skipped,attempted=0,0,0,0
        local firstErrors={}
        local ordered={}
        for _,kind in ipairs({"Floor","Wall","Item","Roof"}) do
            for _,p in ipairs(bp.parts) do
                if p.kind==kind then ordered[#ordered+1]=p end
            end
        end
        local categoryFailures={}
        local maxAttempts=math.min(#ordered,1600)
        for i,p in ipairs(ordered) do
            if not alive or cancel or attempted>=maxAttempts then break end
            if not canPlace(p) then skipped=skipped+1
            elseif (categoryFailures[p.kind] or 0)>=6 then
                skipped=skipped+1
            else
                local before=readModels(own)
                local ok,success,position=pcall(placeOne,p,origin,bp.storeyHeight or 15)
                attempted=attempted+1
                local accepted=false
                if ok and success and typeof(position)=="Vector3" then
                    for j=1,10 do
                        if not alive or cancel then break end
                        if newNearby(own,before,position,p.kind) then
                            accepted=true;break
                        end
                        task.wait(.2)
                    end
                end
                if accepted then
                    confirmed=confirmed+1
                    categoryFailures[p.kind]=0
                else
                    failed=failed+1
                    categoryFailures[p.kind]=(categoryFailures[p.kind] or 0)+1
                    if #firstErrors<12 then
                        firstErrors[#firstErrors+1]=tostring(p.kind).." #"..i..
                            " ID="..tostring(p.id).." : "..
                            tostring(ok and (success and "not replicated" or position) or success)
                    end
                end
                if i%4==0 or not accepted then
                    inform("PASTE "..i.."/"..#ordered.." | confirmed "..confirmed..
                        " | failed "..failed.." | skipped "..skipped)
                end
                task.wait(.16)
            end
        end
        busy=false
        local result="PASTE "..(cancel and "STOPPED" or "FINISHED")..
            ": "..confirmed.." confirmed, "..failed.." unconfirmed, "..
            skipped.." skipped. "..attempted.." requests."
        inform(result,failed>0)
        log("Supported items are experimental; a sent remote is NOT proof of acceptance.")
        for kind,failures in pairs(categoryFailures) do
            if failures>=6 then log(kind.." stage paused after six consecutive unconfirmed requests") end
        end
        for _,e in ipairs(firstErrors) do log(e) end
    end)
end
action(1,1,"COPY PLOT",function()
    if busy then inform("Stop the current paste first",true);return end
    local p=getSelectedPlot()
    if not p then inform("Select a visible player plot first",true);return end
    local bp,ignored=capture(p)
    if not bp then inform(ignored,true);return end
    current=bp
    selectedBase=nil
    nameEntry.Text=bp.name
    armed=false
    if pasteButton then pasteButton.Text="PASTE TO MY PLOT" end
    refresh()
    inform("Captured "..#bp.parts.." objects from "..p.Name..
        " ("..ignored.." skipped). Press SAVE BASE.")
end,true)
action(2,1,"SAVE BASE",saveCurrent,true)
action(3,1,"COPY JSON",copyJson)
pasteButton=action(1,2,"PASTE TO MY PLOT",paste,true)
action(2,2,"STOP",function()
    cancel=true
    if busy then inform("Stopping after current verification...")
    else inform("Nothing is currently pasting") end
end)
action(3,2,"READ GITHUB",downloadLibrary)
local extraY=buttonY+81
local l0=txt(win,"Save JSON locally, or publish files via SavedBases/index.json.",16,extraY,W-30,19,11,COLORS.dim,false)
local logBtn=btn(win,"COPY LOG",W-109,extraY+1,93,20,function()
    local payload=table.concat(logs,"\n")
    local clip=setclipboard or toclipboard
    if type(clip)=="function" then pcall(clip,payload) end
    print(payload)
    inform("Diagnostic log copied or printed")
end)
loadLocal()
refresh()
-- Refresh plot-owner display while the GUI is open, without rebuilding
-- the saved-base list or disturbing the selected plot.
task.spawn(function()
    while alive do
        task.wait(1.5)
        if alive and win.Visible then
            local ok,err=pcall(function() updatePlotRows(false) end)
            if not ok then log("Plot list refresh failed: "..tostring(err)) end
        end
    end
end)
inform("Plot Copier V"..VERSION.." ready. Plot usernames refresh automatically.")
print("[Plot Copier] V"..VERSION.." | Local storage "..folder.." | Plot Studio legacy archived.")
