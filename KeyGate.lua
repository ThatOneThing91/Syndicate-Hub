-- Syndicate Hub integrated key gate.
local Players=game:GetService("Players")
local HttpService=game:GetService("HttpService")
local Input=game:GetService("UserInputService")
local GuiService=game:GetService("GuiService")
local player=Players.LocalPlayer
if not player then return nil end

local env=getgenv and getgenv() or _G
local userId=tostring(player.UserId)
local cacheName="__SyndicateHubMemberKeys"
local cacheFile="SyndicateHub_Key_"..userId..".json"
local endpoint="https://syndicate-auth.loganmatthewsmall.workers.dev/verify"
local invite="https://discord.gg/6K2qGPpuEH"
if type(env[cacheName])~="table" then env[cacheName]={} end
local memory=env[cacheName]

local function normalizeKey(value)
 if type(value)~="string" then return nil end
 local key=value:match("^%s*(.-)%s*$"):upper()
 if key:match("^SYND%-[A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9]%-[A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9]%-[A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9]%-[A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9]$") then
  return key
 end
end

local function requestFunction()
 return request or http_request or (syn and syn.request) or (http and http.request) or (fluxus and fluxus.request)
end

local function verifyRaw(key)
 local send=requestFunction()
 if type(send)~="function" then return nil,"This executor does not support HTTP verification." end
 local finished=false
 local responseOK,response
 task.spawn(function()
  responseOK,response=pcall(send,{
   Url=endpoint,Method="POST",Headers={["Content-Type"]="application/json"},
   Body=HttpService:JSONEncode({key=key,userId=userId}),
  })
  finished=true
 end)
 local started=os.clock()
 while not finished and os.clock()-started<15 do task.wait(0.05) end
 if not finished then return nil,"Verification timed out. Please try again." end
 if not responseOK or type(response)~="table" then return nil,"Cannot reach the key server. Please try again." end
 local code=tonumber(response.StatusCode or response.Status)
 local decoded,result=pcall(function() return HttpService:JSONDecode(response.Body or "") end)
 if (code==200 or code==400) and decoded and type(result)=="table" then
  if result.valid==true then return true,result end
  if result.valid==false then return false,"Key invalid, expired, revoked, or assigned to another Roblox account." end
 end
 if code==429 then return nil,"Too many attempts. Wait a moment, then retry." end
 return nil,"Key server unavailable. Please try again later."
end

local function clearKey()
 memory[userId]=nil
 if type(delfile)=="function" then pcall(delfile,cacheFile) end
 if type(writefile)=="function" then pcall(writefile,cacheFile,"{}") end
end

local function saveKey(key,expiresAt)
 memory[userId]=key
 if type(writefile)=="function" then
  pcall(function()
   writefile(cacheFile,HttpService:JSONEncode({userId=userId,key=key,expiresAt=expiresAt}))
  end)
 end
end

local function readSaved()
 local key=normalizeKey(memory[userId])
 local expiresAt
 if type(readfile)=="function" then
  local ok,record=pcall(function() return HttpService:JSONDecode(readfile(cacheFile)) end)
  if ok and type(record)=="table" and tostring(record.userId)==userId then
   key=key or normalizeKey(record.key)
   expiresAt=record.expiresAt
  end
 end
 return key,expiresAt
end

local savedKey=select(1,readSaved())
local registry="__SyndicateHubIntegratedKeyGate"
local previous=env[registry]
if type(previous)=="table" and type(previous.Cancel)=="function" then pcall(previous.Cancel) end

local gui=Instance.new("ScreenGui")
gui.Name="SyndicateHubKeyGate"
gui.ResetOnSpawn=false
gui.ZIndexBehavior=Enum.ZIndexBehavior.Sibling
gui.DisplayOrder=10000
local parent
local okCore=pcall(function() parent=game:GetService("CoreGui");gui.Parent=parent end)
if not okCore then parent=player:WaitForChild("PlayerGui");gui.Parent=parent end
for _,child in ipairs(parent:GetChildren()) do
 if child~=gui and child.Name=="SyndicateHubKeyGate" then child:Destroy() end
end

local function make(class,props,host)
 local object=Instance.new(class)
 for k,v in pairs(props or {}) do object[k]=v end
 object.Parent=host
 return object
end

local panel=make("Frame",{
 AnchorPoint=Vector2.new(0.5,0.5),Position=UDim2.fromScale(0.5,0.5),Size=UDim2.fromOffset(390,356),
 BackgroundColor3=Color3.fromRGB(20,15,30),BackgroundTransparency=0.04,BorderSizePixel=0,
 Visible=savedKey==nil,Active=true,
},gui)
make("UICorner",{CornerRadius=UDim.new(0,12)},panel)
make("UIStroke",{Color=Color3.fromRGB(176,119,255),Thickness=1.2,Transparency=0.25},panel)

make("TextLabel",{Position=UDim2.fromOffset(20,15),Size=UDim2.new(1,-40,0,28),BackgroundTransparency=1,
 Text="SYNDICATE HUB",TextColor3=Color3.fromRGB(239,233,255),Font=Enum.Font.GothamBold,TextSize=20,
 TextXAlignment=Enum.TextXAlignment.Left,ZIndex=3},panel)
make("TextLabel",{Position=UDim2.fromOffset(20,47),Size=UDim2.new(1,-40,0,22),BackgroundTransparency=1,
 Text="Enter your member key to continue.",TextColor3=Color3.fromRGB(166,154,186),Font=Enum.Font.Gotham,
 TextSize=13,TextXAlignment=Enum.TextXAlignment.Left,ZIndex=3},panel)
make("TextLabel",{Position=UDim2.fromOffset(20,75),Size=UDim2.new(1,-40,0,18),BackgroundTransparency=1,
 Text="Roblox User ID: "..userId,TextColor3=Color3.fromRGB(137,127,154),Font=Enum.Font.Gotham,
 TextSize=11,TextXAlignment=Enum.TextXAlignment.Left,ZIndex=3},panel)

local input=make("TextBox",{Position=UDim2.fromOffset(20,105),Size=UDim2.new(1,-40,0,43),
 BackgroundColor3=Color3.fromRGB(35,27,49),BorderSizePixel=0,Text=savedKey or "",
 PlaceholderText="SYND-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX",PlaceholderColor3=Color3.fromRGB(126,116,143),
 TextColor3=Color3.fromRGB(245,241,250),Font=Enum.Font.Gotham,TextSize=12,ClearTextOnFocus=false,
 TextTruncate=Enum.TextTruncate.AtEnd,Selectable=true,ZIndex=3},panel)
make("UICorner",{CornerRadius=UDim.new(0,7)},input)

local status=make("TextLabel",{Position=UDim2.fromOffset(20,158),Size=UDim2.new(1,-40,0,48),
 BackgroundTransparency=1,Text="Keys are checked with the Syndicate server.",TextColor3=Color3.fromRGB(166,154,186),
 Font=Enum.Font.Gotham,TextSize=12,TextWrapped=true,TextXAlignment=Enum.TextXAlignment.Left,
 TextYAlignment=Enum.TextYAlignment.Top,ZIndex=3},panel)

local unlock=make("TextButton",{Position=UDim2.fromOffset(20,220),Size=UDim2.new(0.64,-26,0,40),
 BackgroundColor3=Color3.fromRGB(153,102,204),BorderSizePixel=0,Text="Unlock",
 TextColor3=Color3.fromRGB(255,255,255),Font=Enum.Font.GothamBold,TextSize=14,Selectable=true,ZIndex=3},panel)
make("UICorner",{CornerRadius=UDim.new(0,7)},unlock)
local close=make("TextButton",{Position=UDim2.new(0.64,0,0,220),Size=UDim2.new(0.36,-20,0,40),
 BackgroundColor3=Color3.fromRGB(48,40,58),BorderSizePixel=0,Text="Close",
 TextColor3=Color3.fromRGB(239,233,255),Font=Enum.Font.Gotham,TextSize=13,Selectable=true,ZIndex=3},panel)
make("UICorner",{CornerRadius=UDim.new(0,7)},close)
local discord=make("TextButton",{Position=UDim2.fromOffset(20,276),Size=UDim2.new(1,-40,0,42),
 BackgroundColor3=Color3.fromRGB(70,78,165),BorderSizePixel=0,Text="Discord Server  ·  Copy Invite",
 TextColor3=Color3.fromRGB(255,255,255),Font=Enum.Font.GothamBold,TextSize=12,Selectable=true,ZIndex=3},panel)
make("UICorner",{CornerRadius=UDim.new(0,7)},discord)
make("TextLabel",{Position=UDim2.fromOffset(20,326),Size=UDim2.new(1,-40,0,18),BackgroundTransparency=1,
 Text="Free keys: 24 hours   ·   Premium keys: lifetime",TextColor3=Color3.fromRGB(126,116,143),
 Font=Enum.Font.Gotham,TextSize=10,TextXAlignment=Enum.TextXAlignment.Center,ZIndex=3},panel)

local dragHandle=make("TextButton",{Position=UDim2.fromOffset(0,0),Size=UDim2.new(1,0,0,62),
 BackgroundTransparency=1,Text="",AutoButtonColor=false,Selectable=false,ZIndex=2},panel)

unlock.NextSelectionRight=close
close.NextSelectionLeft=unlock
unlock.NextSelectionDown=discord
close.NextSelectionDown=discord
discord.NextSelectionUp=unlock

local connections={}
local finished=false
local granted
local busy=false
local dragInput,dragStart,panelStart
local gate={}
env[registry]=gate

local function disconnectAll()
 for _,connection in ipairs(connections) do pcall(function() connection:Disconnect() end) end
 table.clear(connections)
end
local function finish(session)
 if finished then return end
 finished=true
 granted=session
 disconnectAll()
 if env[registry]==gate then env[registry]=nil end
 if gui.Parent then gui:Destroy() end
end
gate.Cancel=function() finish(nil) end

local function setBusy(value)
 busy=value
 unlock.Text=value and "Checking..." or "Unlock"
 unlock.Active=not value
 unlock.AutoButtonColor=not value
end

local function submit()
 if finished or busy then return end
 local key=normalizeKey(input.Text)
 if not key then
  panel.Visible=true
  status.Text="Enter a complete SYND member key."
  if Input.GamepadEnabled then pcall(function() GuiService.SelectedObject=unlock end) end
  return
 end
 setBusy(true)
 status.Text="Verifying your member key..."
 task.spawn(function()
  local valid,result=verifyRaw(key)
  if finished then return end
  setBusy(false)
  if valid==true then
   local expiresAt=result and result.expiresAt or nil
   saveKey(key,expiresAt)
   local session={key=key,expiresAt=expiresAt,tier=expiresAt and "Free" or "Premium"}
   session.Verify=function(self)
    local currentValid,currentResult=verifyRaw(self.key)
    if currentValid==true and type(currentResult)=="table" then
     self.expiresAt=currentResult.expiresAt
     self.tier=currentResult.expiresAt and "Free" or "Premium"
    end
    return currentValid,currentResult
   end
   session.Clear=function() clearKey() end
   finish(session)
  elseif valid==false then
   clearKey()
   input.Text=""
   panel.Visible=true
   status.Text=tostring(result)
   if Input.GamepadEnabled then pcall(function() GuiService.SelectedObject=unlock end) end
  else
   panel.Visible=true
   status.Text=tostring(result)
   if Input.GamepadEnabled then pcall(function() GuiService.SelectedObject=unlock end) end
  end
 end)
end

connections[#connections+1]=unlock.Activated:Connect(submit)
connections[#connections+1]=close.Activated:Connect(gate.Cancel)
connections[#connections+1]=discord.Activated:Connect(function()
 local clipboard=setclipboard or toclipboard or (syn and syn.write_clipboard)
 if type(clipboard)=="function" then
  local ok=pcall(clipboard,invite)
  status.Text=ok and "Discord invite copied to clipboard!" or invite
 else
  status.Text=invite
 end
end)
connections[#connections+1]=input.FocusLost:Connect(function(enterPressed) if enterPressed then submit() end end)
connections[#connections+1]=dragHandle.InputBegan:Connect(function(event)
 if dragInput then return end
 if event.UserInputType~=Enum.UserInputType.MouseButton1 and event.UserInputType~=Enum.UserInputType.Touch then return end
 dragInput,dragStart,panelStart=event,event.Position,panel.Position
end)
connections[#connections+1]=Input.InputChanged:Connect(function(event)
 if not dragInput then return end
 local mouseDrag=dragInput.UserInputType==Enum.UserInputType.MouseButton1 and event.UserInputType==Enum.UserInputType.MouseMovement
 if not mouseDrag and event~=dragInput then return end
 local delta=event.Position-dragStart
 panel.Position=UDim2.new(panelStart.X.Scale,panelStart.X.Offset+delta.X,panelStart.Y.Scale,panelStart.Y.Offset+delta.Y)
end)
connections[#connections+1]=Input.InputEnded:Connect(function(event) if event==dragInput then dragInput=nil end end)
connections[#connections+1]=gui.Destroying:Connect(function()
 if not finished then
  finished=true
  granted=nil
  disconnectAll()
  if env[registry]==gate then env[registry]=nil end
 end
end)

if savedKey then
 input.Text=savedKey
 panel.Visible=false
 submit()
else
 panel.Visible=true
 if Input.GamepadEnabled then pcall(function() GuiService.SelectedObject=unlock end) end
end

while not finished do task.wait(0.05) end
return granted
