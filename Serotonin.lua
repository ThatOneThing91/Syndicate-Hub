-- Syndicate Hub: native Serotonin edition, build native-5.
-- Uses Serotonin's ui/cheat/http APIs; does not create Roblox ScreenGui objects.
-- Automation controls appear only when the actual remote-call methods are exposed.
-- Full auction/fishing/garden/placement features are not ported.
local VERSION="native-5"
local ENDPOINT="https://syndicate-auth.loganmatthewsmall.workers.dev/verify"
local INVITE="https://discord.gg/3gc7jAGKtr"
local TAB="syndicate_serotonin_native"
local ACCESS,SHOP,COMPAT="access","shop","compatibility"
local environment=getfenv(1)
local old=environment.__SyndicateNativePort
if type(old)=="table" and type(old.Stop)=="function" then pcall(old.Stop) end
local HubDestroyed=false
local controller={active=true,handlers={},ownedUI={}}
environment.__SyndicateNativePort=controller
local State,ToggleObjects,features={},{},{}
local ThisHubInstance=controller
local ShopPage=SHOP
local scheduler
local auth={valid=false,busy=false,untilAt=0,nextCheck=0,generation=0}
local identity
local statusText="Enter your member key to verify access."
local loadedCount=0
local function read(object,key)
    if object==nil then return nil end
    local ok,value=pcall(function() return object[key] end)
    if ok then return value end
end
local function pick(lib,...)
    if lib==nil then return nil end
    for index=1,select("#",...) do
        local fn=read(lib,select(index,...))
        if type(fn)=="function" then return fn end
    end
end
local uiAPI={
    tab=pick(ui,"newTab","NewTab","new_tab"),
    container=pick(ui,"newContainer","NewContainer","new_container"),
    input=pick(ui,"newInputText","NewInputText","new_input_text"),
    button=pick(ui,"newButton","NewButton","new_button"),
    check=pick(ui,"newCheckbox","NewCheckbox","new_checkbox"),
    list=pick(ui,"newListbox","NewListbox","new_listbox"),
    get=pick(ui,"getValue","GetValue","get_value"),
    set=pick(ui,"setValue","SetValue","set_value"),
    visible=pick(ui,"setVisibility","SetVisibility","set_visibility"),
}
local function report(message)
    statusText=tostring(message)
    print("[Syndicate / Serotonin] "..statusText)
    if uiAPI.set then pcall(uiAPI.set,TAB,ACCESS,"Status",statusText) end
end
local function Notify(title,message)
    report(tostring(title)..": "..tostring(message))
end
local function owned(group,label)
    controller.ownedUI[#controller.ownedUI+1]={group,label}
    if uiAPI.visible then pcall(uiAPI.visible,TAB,group,label,true) end
end
local function setValue(group,label,value)
    if uiAPI.set then pcall(uiAPI.set,TAB,group,label,value) end
end
local function setStatus(message)
    statusText=tostring(message)
    setValue(ACCESS,"Status",statusText)
end
local function currentIdentity()
    local fn=pick(entity,"GetLocalPlayer","getLocalPlayer","get_local_player")
    if not fn then return nil end
    local ok,player=pcall(fn)
    if not ok or not player then return nil end
    local id=tonumber(read(player,"UserId"))
    if not id or id<=0 or id~=math.floor(id) then return nil end
    return tostring(id),tostring(read(player,"Name") or "")
end
local function service(name)
    local get=pick(game,"GetService","getService","get_service")
    if get then
        local ok,value=pcall(get,name)
        if ok and value then return value end
        ok,value=pcall(get,game,name)
        if ok and value then return value end
    end
    -- Only these direct service fields are documented on the game proxy.
    if name=="Players" or name=="Workspace" then return read(game,name) end
end
local function child(node,name)
    local find=pick(node,"FindFirstChild","findFirstChild","find_first_child")
    if not find then return nil end
    local ok,value=pcall(find,node,name)
    if ok then return value end
end
local function path(root,names)
    local node=root
    for _,name in ipairs(names) do node=child(node,name);if not node then return nil end end
    return node
end
local function attribute(node,name)
    local get=pick(node,"GetAttribute","getAttribute","get_attribute")
    if not get then return nil end
    local ok,value=pcall(get,node,name)
    if not ok then return nil end
    if type(value)=="table" and value.Value~=nil then return value.Value end
    return value
end
local function authorized()
    if HubDestroyed or not auth.valid or not scheduler or scheduler.now()>auth.untilAt then return false end
    local id=currentIdentity()
    return id~=nil and id==identity
end
local function stopFeatures()
    for _,feature in ipairs(features) do
        State[feature.key]=false
        feature.value=false
        setValue(SHOP,feature.label,false)
    end
    if controller.StopPotionLoader then pcall(controller.StopPotionLoader) end
end
controller.Stop=function()
    if HubDestroyed then return end
    HubDestroyed=true;controller.active=false
    auth.generation=auth.generation+1;auth.valid=false
    stopFeatures()
    if scheduler then scheduler.stop() end
    if uiAPI.visible then
        for _,item in ipairs(controller.ownedUI) do pcall(uiAPI.visible,TAB,item[1],item[2],false) end
    end
end
local function protectedCall(raw,...)
    if not authorized() then error("Verify your active member key before using automation.") end
    local invoke=pick(raw,"InvokeServer","invokeServer","invoke_server")
    if not invoke then error("This Serotonin build does not expose InvokeServer.") end
    return invoke(raw,...)
end
local proxies=setmetatable({},{__mode="kv"})
local function nodeProxy(raw)
    if not raw then return nil end
    if proxies[raw] then return proxies[raw] end
    local proxy={}
    proxies[raw]=proxy
    return setmetatable(proxy,{__index=function(_,key)
        if key=="FindFirstChild" then return function(_,name) return nodeProxy(child(raw,name)) end end
        if key=="GetAttribute" then return function(_,name) return attribute(raw,name) end end
        if key=="InvokeServer" then
            if not pick(raw,"InvokeServer","invokeServer","invoke_server") then return nil end
            return function(_,...) return protectedCall(raw,...) end
        end
        if key=="IsA" then return function(_,name) return read(raw,"ClassName")==name end end
        local value=read(raw,key)
        if type(value)=="function" then return function(_,...) return value(raw,...) end end
        return value
    end})
end
local function rawLocalPlayer()
    local id,name=currentIdentity()
    if not id or name=="" then return nil end
    return child(service("Players"),name)
end
local LocalPlayer={GetAttribute=function(_,name) return attribute(rawLocalPlayer(),name) end}
local ReplicatedStorage=nodeProxy(service("ReplicatedStorage"))
local cachedVehicle,cachedVehicleId,lastVehicleSearch
local function GetMyVehicle()
    local vehicleId=attribute(rawLocalPlayer(),"EquippedVehicle")
    if not vehicleId or vehicleId=="" then return nil end
    if cachedVehicle and cachedVehicleId==vehicleId and read(cachedVehicle,"Parent") then return nodeProxy(cachedVehicle) end
    if lastVehicleSearch and scheduler.now()-lastVehicleSearch<3 then return nil end
    lastVehicleSearch=scheduler.now()
    local workspace=service("Workspace")
    local roots={child(workspace,"_Vehicles"),child(workspace,"_Debris"),child(workspace,"Vehicles"),workspace}
    for index=1,4 do
        local root=roots[index]
        local get=root and (index==4 and pick(root,"GetChildren","getChildren","get_children") or pick(root,"GetDescendants","getDescendants","get_descendants"))
        if get then
            local ok,objects=pcall(get,root)
            if ok and type(objects)=="table" then
                for _,object in ipairs(objects) do
                    if read(object,"ClassName")=="Model" and (attribute(object,"VehicleGUID")==vehicleId or attribute(object,"GUID")==vehicleId) then
                        cachedVehicle,cachedVehicleId=object,vehicleId
                        return nodeProxy(object)
                    end
                end
            end
        end
    end
    return nil
end
local rawStorage=service("ReplicatedStorage")
local function remote(names)
    local object=path(rawStorage,names)
    return object,pick(object,"InvokeServer","invokeServer","invoke_server")~=nil
end
local inventoryRemote,hasInventory=remote({"Events","Inventory","GetPlayerInventory"})
local transferRemote,hasTransfer=remote({"Events","Vehicles","TransferInventoryItemToVehicle"})
local cargoRemote,hasCargo=remote({"Events","Vehicles","GetVehicleItems"})
local dailyRemote,hasDaily=remote({"Events","DailyReward","ClaimDailyReward"})
local museumRemote,hasMuseum=remote({"Events","Museum","Collect"})
local marketRemote,hasMarket=remote({"Events","HalloweenMarket","Roll"})
local capability={
    AutoLoadPotions=hasInventory and hasTransfer and hasCargo,
    AutoDailyRewards=hasDaily,AutoMuseumGift=hasMuseum,AutoMarketRolling=hasMarket
}
local function CreateToggle(_,label,key,callback)
    local feature={label=label,key=key,callback=callback,value=false,available=capability[key]==true}
    features[#features+1]=feature
    State[key]=false
    ToggleObjects[key]=function(value)
        State[key]=value;feature.value=value
        setValue(SHOP,label,value)
    end
    -- Register every implemented control even when the corresponding remote
    -- is temporarily unavailable; showFeature controls visibility and access.
    if uiAPI.check then
        local ok=pcall(uiAPI.check,TAB,SHOP,label)
        if ok then
            owned(SHOP,label);setValue(SHOP,label,false)
            feature.created=true
            if uiAPI.visible then pcall(uiAPI.visible,TAB,SHOP,label,false) end
        end
    end
    return feature
end

local JSON=(function()
--
-- json.lua
--
-- Copyright (c) 2020 rxi
--
-- Permission is hereby granted, free of charge, to any person obtaining a copy of
-- this software and associated documentation files (the "Software"), to deal in
-- the Software without restriction, including without limitation the rights to
-- use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
-- of the Software, and to permit persons to whom the Software is furnished to do
-- so, subject to the following conditions:
--
-- The above copyright notice and this permission notice shall be included in all
-- copies or substantial portions of the Software.
--
-- THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
-- IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
-- FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
-- AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
-- LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
-- OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
-- SOFTWARE.
--

local json = { _version = "0.1.2" }

-------------------------------------------------------------------------------
-- Encode
-------------------------------------------------------------------------------

local encode

local escape_char_map = {
  [ "\\" ] = "\\",
  [ "\"" ] = "\"",
  [ "\b" ] = "b",
  [ "\f" ] = "f",
  [ "\n" ] = "n",
  [ "\r" ] = "r",
  [ "\t" ] = "t",
}

local escape_char_map_inv = { [ "/" ] = "/" }
for k, v in pairs(escape_char_map) do
  escape_char_map_inv[v] = k
end


local function escape_char(c)
  return "\\" .. (escape_char_map[c] or string.format("u%04x", c:byte()))
end


local function encode_nil(val)
  return "null"
end


local function encode_table(val, stack)
  local res = {}
  stack = stack or {}

  -- Circular reference?
  if stack[val] then error("circular reference") end

  stack[val] = true

  if rawget(val, 1) ~= nil or next(val) == nil then
    -- Treat as array -- check keys are valid and it is not sparse
    local n = 0
    for k in pairs(val) do
      if type(k) ~= "number" then
        error("invalid table: mixed or invalid key types")
      end
      n = n + 1
    end
    if n ~= #val then
      error("invalid table: sparse array")
    end
    -- Encode
    for i, v in ipairs(val) do
      table.insert(res, encode(v, stack))
    end
    stack[val] = nil
    return "[" .. table.concat(res, ",") .. "]"

  else
    -- Treat as an object
    for k, v in pairs(val) do
      if type(k) ~= "string" then
        error("invalid table: mixed or invalid key types")
      end
      table.insert(res, encode(k, stack) .. ":" .. encode(v, stack))
    end
    stack[val] = nil
    return "{" .. table.concat(res, ",") .. "}"
  end
end


local function encode_string(val)
  return '"' .. val:gsub('[%z\1-\31\\"]', escape_char) .. '"'
end


local function encode_number(val)
  -- Check for NaN, -inf and inf
  if val ~= val or val <= -math.huge or val >= math.huge then
    error("unexpected number value '" .. tostring(val) .. "'")
  end
  return string.format("%.14g", val)
end


local type_func_map = {
  [ "nil"     ] = encode_nil,
  [ "table"   ] = encode_table,
  [ "string"  ] = encode_string,
  [ "number"  ] = encode_number,
  [ "boolean" ] = tostring,
}


encode = function(val, stack)
  local t = type(val)
  local f = type_func_map[t]
  if f then
    return f(val, stack)
  end
  error("unexpected type '" .. t .. "'")
end


function json.encode(val)
  return ( encode(val) )
end


-------------------------------------------------------------------------------
-- Decode
-------------------------------------------------------------------------------

local parse

local function create_set(...)
  local res = {}
  for i = 1, select("#", ...) do
    res[ select(i, ...) ] = true
  end
  return res
end

local space_chars   = create_set(" ", "\t", "\r", "\n")
local delim_chars   = create_set(" ", "\t", "\r", "\n", "]", "}", ",")
local escape_chars  = create_set("\\", "/", '"', "b", "f", "n", "r", "t", "u")
local literals      = create_set("true", "false", "null")

local literal_map = {
  [ "true"  ] = true,
  [ "false" ] = false,
  [ "null"  ] = nil,
}


local function next_char(str, idx, set, negate)
  for i = idx, #str do
    if set[str:sub(i, i)] ~= negate then
      return i
    end
  end
  return #str + 1
end


local function decode_error(str, idx, msg)
  local line_count = 1
  local col_count = 1
  for i = 1, idx - 1 do
    col_count = col_count + 1
    if str:sub(i, i) == "\n" then
      line_count = line_count + 1
      col_count = 1
    end
  end
  error( string.format("%s at line %d col %d", msg, line_count, col_count) )
end


local function codepoint_to_utf8(n)
  -- http://scripts.sil.org/cms/scripts/page.php?site_id=nrsi&id=iws-appendixa
  local f = math.floor
  if n <= 0x7f then
    return string.char(n)
  elseif n <= 0x7ff then
    return string.char(f(n / 64) + 192, n % 64 + 128)
  elseif n <= 0xffff then
    return string.char(f(n / 4096) + 224, f(n % 4096 / 64) + 128, n % 64 + 128)
  elseif n <= 0x10ffff then
    return string.char(f(n / 262144) + 240, f(n % 262144 / 4096) + 128,
                       f(n % 4096 / 64) + 128, n % 64 + 128)
  end
  error( string.format("invalid unicode codepoint '%x'", n) )
end


local function parse_unicode_escape(s)
  local n1 = tonumber( s:sub(1, 4),  16 )
  local n2 = tonumber( s:sub(7, 10), 16 )
   -- Surrogate pair?
  if n2 then
    return codepoint_to_utf8((n1 - 0xd800) * 0x400 + (n2 - 0xdc00) + 0x10000)
  else
    return codepoint_to_utf8(n1)
  end
end


local function parse_string(str, i)
  local res = ""
  local j = i + 1
  local k = j

  while j <= #str do
    local x = str:byte(j)

    if x < 32 then
      decode_error(str, j, "control character in string")

    elseif x == 92 then -- `\`: Escape
      res = res .. str:sub(k, j - 1)
      j = j + 1
      local c = str:sub(j, j)
      if c == "u" then
        local hex = str:match("^[dD][89aAbB]%x%x\\u%x%x%x%x", j + 1)
                 or str:match("^%x%x%x%x", j + 1)
                 or decode_error(str, j - 1, "invalid unicode escape in string")
        res = res .. parse_unicode_escape(hex)
        j = j + #hex
      else
        if not escape_chars[c] then
          decode_error(str, j - 1, "invalid escape char '" .. c .. "' in string")
        end
        res = res .. escape_char_map_inv[c]
      end
      k = j + 1

    elseif x == 34 then -- `"`: End of string
      res = res .. str:sub(k, j - 1)
      return res, j + 1
    end

    j = j + 1
  end

  decode_error(str, i, "expected closing quote for string")
end


local function parse_number(str, i)
  local x = next_char(str, i, delim_chars)
  local s = str:sub(i, x - 1)
  local n = tonumber(s)
  if not n then
    decode_error(str, i, "invalid number '" .. s .. "'")
  end
  return n, x
end


local function parse_literal(str, i)
  local x = next_char(str, i, delim_chars)
  local word = str:sub(i, x - 1)
  if not literals[word] then
    decode_error(str, i, "invalid literal '" .. word .. "'")
  end
  return literal_map[word], x
end


local function parse_array(str, i)
  local res = {}
  local n = 1
  i = i + 1
  while 1 do
    local x
    i = next_char(str, i, space_chars, true)
    -- Empty / end of array?
    if str:sub(i, i) == "]" then
      i = i + 1
      break
    end
    -- Read token
    x, i = parse(str, i)
    res[n] = x
    n = n + 1
    -- Next token
    i = next_char(str, i, space_chars, true)
    local chr = str:sub(i, i)
    i = i + 1
    if chr == "]" then break end
    if chr ~= "," then decode_error(str, i, "expected ']' or ','") end
  end
  return res, i
end


local function parse_object(str, i)
  local res = {}
  i = i + 1
  while 1 do
    local key, val
    i = next_char(str, i, space_chars, true)
    -- Empty / end of object?
    if str:sub(i, i) == "}" then
      i = i + 1
      break
    end
    -- Read key
    if str:sub(i, i) ~= '"' then
      decode_error(str, i, "expected string for key")
    end
    key, i = parse(str, i)
    -- Read ':' delimiter
    i = next_char(str, i, space_chars, true)
    if str:sub(i, i) ~= ":" then
      decode_error(str, i, "expected ':' after key")
    end
    i = next_char(str, i + 1, space_chars, true)
    -- Read value
    val, i = parse(str, i)
    -- Set
    res[key] = val
    -- Next token
    i = next_char(str, i, space_chars, true)
    local chr = str:sub(i, i)
    i = i + 1
    if chr == "}" then break end
    if chr ~= "," then decode_error(str, i, "expected '}' or ','") end
  end
  return res, i
end


local char_func_map = {
  [ '"' ] = parse_string,
  [ "0" ] = parse_number,
  [ "1" ] = parse_number,
  [ "2" ] = parse_number,
  [ "3" ] = parse_number,
  [ "4" ] = parse_number,
  [ "5" ] = parse_number,
  [ "6" ] = parse_number,
  [ "7" ] = parse_number,
  [ "8" ] = parse_number,
  [ "9" ] = parse_number,
  [ "-" ] = parse_number,
  [ "t" ] = parse_literal,
  [ "f" ] = parse_literal,
  [ "n" ] = parse_literal,
  [ "[" ] = parse_array,
  [ "{" ] = parse_object,
}


parse = function(str, idx)
  local chr = str:sub(idx, idx)
  local f = char_func_map[chr]
  if f then
    return f(str, idx)
  end
  decode_error(str, idx, "unexpected character '" .. chr .. "'")
end


function json.decode(str)
  if type(str) ~= "string" then
    error("expected argument of type string, got " .. type(str))
  end
  local res, idx = parse(str, next_char(str, 1, space_chars, true))
  idx = next_char(str, idx, space_chars, true)
  if idx <= #str then
    decode_error(str, idx, "trailing garbage")
  end
  return res
end


return json

end)()

local function callbackTaskScheduler()
    local register = type(cheat) == "table" and (cheat.register or cheat.Register)
    local getTicks = type(utility) == "table" and
        (utility.GetTickCount or utility.getTickCount or utility.get_tick_count)
    if type(register) ~= "function" or type(getTicks) ~= "function"
        or type(coroutine) ~= "table" or type(coroutine.create) ~= "function" then
        return nil, "Serotonin callback scheduling requires cheat.register, utility.GetTickCount and coroutine support."
    end
    local unpackArgs = table.unpack or unpack
    local previousTick, elapsed, epoch, stopped = nil, 0, 0, false
    local jobs, api = {}, {}
    local function clock()
        local current = tonumber(getTicks())
        if not current then error("Serotonin's clock returned no numeric timestamp.") end
        if previousTick then
            local delta = current - previousTick
            if delta < -2147483648 then delta = delta + 4294967296 end
            elapsed = elapsed + math.max(0, delta) / 1000
        end
        previousTick = current
        return elapsed
    end
    clock()
    local function enqueue(seconds, callback, ...)
        if stopped then error("The Serotonin scheduler has stopped.") end
        local thread = callback
        if type(callback) == "function" then thread = coroutine.create(callback) end
        if type(thread) ~= "thread" or coroutine.status(thread) ~= "suspended" then
            error("A scheduled task must be a function or a suspended coroutine.")
        end
        if jobs[thread] then error("This coroutine is already scheduled.") end
        jobs[thread] = {thread=thread, due=clock()+math.max(0, tonumber(seconds) or 0),
            epoch=epoch+1, args={...}, count=select("#", ...), ready=true}
        return thread
    end
    api.now = clock
    api.spawn = function(callback, ...) return enqueue(0, callback, ...) end
    api.defer = function(callback, ...) return enqueue(0, callback, ...) end
    api.delay = function(seconds, callback, ...) return enqueue(seconds, callback, ...) end
    api.wait = function(seconds)
        local thread = coroutine.running()
        local job = thread and jobs[thread]
        if not job then error("task.wait must run inside a scheduled hub coroutine.") end
        job.started = clock()
        job.due = job.started + math.max(0, tonumber(seconds) or 0)
        job.epoch, job.ready, job.waiting = epoch+1, true, true
        return coroutine.yield()
    end
    api.cancel = function(thread)
        jobs[thread] = nil
    end
    api.stop = function()
        if stopped then return end
        stopped = true
        for thread in pairs(jobs) do jobs[thread] = nil end
    end
    local function pump()
        if stopped then return end
        epoch = epoch + 1
        local now, ready = clock(), {}
        for _, job in pairs(jobs) do
            if job.ready and job.epoch <= epoch and job.due <= now then ready[#ready+1]=job end
        end
        table.sort(ready, function(a,b) return a.due < b.due end)
        for index=1, math.min(#ready, 64) do
            local job=ready[index]
            if jobs[job.thread] == job and not stopped then
                job.ready = false
                local ok, message
                if job.waiting then
                    job.waiting = false
                    ok, message = coroutine.resume(job.thread, now-job.started)
                else
                    ok, message = coroutine.resume(job.thread, unpackArgs(job.args,1,job.count))
                    job.args, job.count = {}, 0
                end
                if not ok then
                    api.stop()
                    report("Hub coroutine stopped: " .. tostring(message))
                    controller.Stop()
                    return
                elseif coroutine.status(job.thread) == "dead" then
                    jobs[job.thread] = nil
                end
            end
        end
    end
    local installed, reason = pcall(register, "onUpdate", function()
        local ok, message=pcall(pump)
        if not ok and not stopped then api.stop(); report("Scheduler stopped: " .. tostring(message)) end
    end)
    if not installed then api.stop(); return nil, tostring(reason) end
    local unloadInstalled = pcall(register, "shutdown", api.stop)
    local placeInstalled = pcall(register, "newPlace", api.stop)
    if not unloadInstalled or not placeInstalled then
        api.stop()
        return nil, "Could not register Serotonin scheduler cleanup."
    end
    local environment
    if type(getgenv) == "function" then
        local ok, value = pcall(getgenv)
        if ok and type(value) == "table" then environment = value end
    end
    if not environment and type(getfenv) == "function" then
        local ok, value = pcall(getfenv, 1)
        if ok and type(value) == "table" then environment = value end
    end
    if environment then
        local prior=environment.__SyndicateSerotoninScheduler
        if type(prior) == "table" and type(prior.stop) == "function" then pcall(prior.stop) end
        environment.__SyndicateSerotoninScheduler=api
    end
    return api
end


for _,name in ipairs({"tab","container","input","button","check","get","set"}) do
    if not uiAPI[name] then
        report("Serotonin's native UI function '"..name.."' is unavailable; this edition cannot open.")
        controller.active=false
        return
    end
end
uiAPI.tab(TAB,"Syndicate Hub")
uiAPI.container(TAB,ACCESS,"Member Access")
uiAPI.container(TAB,SHOP,"Shop")
uiAPI.container(TAB,COMPAT,"Serotonin Support")
local function input(group,label)
    uiAPI.input(TAB,group,label);owned(group,label)
end
local function button(group,label,action)
    uiAPI.button(TAB,group,label,function()
        local current=environment.__SyndicateNativePort
        if current and current.active and current.handlers[action] then current.handlers[action]() end
    end)
    owned(group,label)
end
input(ACCESS,"Member Key")
input(ACCESS,"Status")
input(COMPAT,"Available Automation")
input(COMPAT,"Full Hub Features")
setValue(COMPAT,"Full Hub Features","Only the available Shop controls are ported. Auctions, fishing, garden, grading, selling, washing, repair and placement are not ported.")
button(ACCESS,"Verify Key","verify")
button(ACCESS,"Lock Menu / Stop Automation","lock")
button(ACCESS,"Copy Discord Invite","discord")
button(COMPAT,"Recheck Runtime Support","refresh")
button(COMPAT,"Show Status in Console","status")
button(COMPAT,"Unload Syndicate","close")
scheduler=assert(callbackTaskScheduler())
local task=scheduler

do
(function()
    local key = "AutoLoadPotions"
    local potionIds = {["893"]=true, ["886"]=true, ["891"]=true, ["1417"]=true,
        ["359"]=true, ["894"]=true, ["890"]=true}
    local serial, running = 0, false
    State[key] = false

    local function active(run)
        return not HubDestroyed and State[key] and serial == run
    end
    local function stop()
        serial = serial + 1
        State[key] = false
        if ToggleObjects[key] then ToggleObjects[key](false) end
    end
    ThisHubInstance.StopPotionLoader = stop

    local definitionPotions = {}
    local wrappers = {Data=true, data=true, Item=true, item=true, Details=true, details=true,
        ItemData=true, itemData=true, Metadata=true, metadata=true}
    local containers = {Inventory=true, inventory=true, Items=true, items=true,
        Favorites=true, favorites=true, Favourites=true, favourites=true,
        Potions=true, potions=true, Consumables=true, consumables=true}
    local function potionName(value)
        if type(value) ~= "string" then return false end
        local name = value:lower():gsub("[%s%p_]", "")
        return name:find("potion", 1, true) ~= nil or name == "luckdrink1"
    end
    local function readGuid(data, depth)
        if type(data) ~= "table" then return nil end
        depth = depth or 0
        if depth > 5 then return nil end
        local guid = data.GUID or data.Guid or data.guid or data.UUID or data.Uuid or data.uuid
            or data.UniqueId or data.uniqueId or data.InventoryId or data.inventoryId
        if type(guid) == "string" and guid ~= "" then return guid end
        local id = data.ID or data.Id or data.id
        if type(id) == "string" and id:match("^%x+%-%x+%-%x+%-%x+%-%x+$") then return id end
        for name in pairs(wrappers) do
            local nested = readGuid(data[name], depth + 1)
            if nested then return nested end
        end
    end
    local function potionDefinition(data)
        if type(data) ~= "table" then return false end
        return potionName(data.Name or data.name or data.ItemName or data.itemName or data.DisplayName)
            or potionName(data.Category or data.category or data.ItemType or data.itemType or data.Type or data.type)
            or potionName(data.Interactive or data.interactive)
    end
    local function isPotion(data, depth, seen)
        if type(data) == "string" or type(data) == "number" then
            local id = tostring(data)
            return potionIds[id] == true or definitionPotions[id] == true
        end
        if type(data) ~= "table" then return false end
        depth, seen = depth or 0, seen or {}
        if depth > 5 or seen[data] then return false end
        seen[data] = true
        local id = data.ItemId or data.ItemID or data.itemId or data.itemID
            or data.item_id or data.ID or data.Id or data.id
        if id ~= nil and (potionIds[tostring(id)] or definitionPotions[tostring(id)]) then return true end
        if potionDefinition(data) then return true end
        for name in pairs(wrappers) do
            if isPotion(data[name], depth + 1, seen) then return true end
        end
        return false
    end
    local function potionInventory(result, run)
        if type(result) ~= "table" then error("Inventory response could not be verified.") end
        local found, seen, scanned = {}, {}, 0
        local function scan(node, fallbackGuid, lost, depth)
            if not active(run) or depth > 12 then return end
            if type(node) ~= "table" then
                if fallbackGuid and fallbackGuid:match("^%x+%-%x+%-%x+%-%x+%-%x+$")
                    and not lost and isPotion(node) then found[fallbackGuid] = node end
                return
            end
            if seen[node] then return end
            seen[node] = true
            scanned = scanned + 1
            if scanned % 200 == 0 then task.wait(); if not active(run) then return end end
            local guid = readGuid(node) or fallbackGuid
            lost = lost or node.Lost == true or node.lost == true
            if guid and isPotion(node) then
                if not lost then found[guid] = node end
                return
            end
            for name, child in pairs(node) do
                if type(child) == "table" or type(child) == "string" or type(child) == "number" then
                    local childGuid
                    if wrappers[name] then
                        childGuid = guid
                    elseif type(name) == "string" and not containers[name] then
                        childGuid = name
                    end
                    scan(child, childGuid, lost, depth + 1)
                end
            end
        end
        -- Scan the whole response, including separate favorites and array-shaped item lists.
        -- Favorite flags never exclude an item or change its favorite setting.
        scan(result, nil, false, 0)
        return found
    end
    local function itemMap(result)
        if type(result) ~= "table" then error("Item list could not be verified.") end
        local items = result.Inventory or result.Items or result
        if type(items) ~= "table" then error("Item list could not be verified.") end
        return items
    end
    local function contains(items, guid)
        if items[guid] ~= nil then return true end
        for _, item in pairs(items) do
            if type(item) == "table" then
                if readGuid(item) == guid then return true end
                for name in pairs(wrappers) do
                    if readGuid(item[name]) == guid then return true end
                end
            end
        end
        return false
    end
    local function vehicleFull(vehicle, items)
        local weight = tonumber(vehicle:GetAttribute("CargoWeight")) or 0
        local limit = tonumber(vehicle:GetAttribute("CargoWeightLimit")) or 0
        if limit > 0 and weight >= limit then return true end
        local capacity = tonumber(vehicle:GetAttribute("CargoCapacity"))
            or tonumber(vehicle:GetAttribute("ItemCapacity"))
            or tonumber(vehicle:GetAttribute("StorageCapacity"))
        if capacity and capacity > 0 then
            local count = 0
            for _ in pairs(items) do count = count + 1 end
            return count >= capacity
        end
        return false
    end

    local ensureWorker
    ensureWorker = function()
        if running or HubDestroyed or not State[key] then return end
        running = true
        local run = serial
        task.spawn(function()
            local ok, message = pcall(function()
                local events = ReplicatedStorage:FindFirstChild("Events")
                local inventoryEvents = events and events:FindFirstChild("Inventory")
                local vehicleEvents = events and events:FindFirstChild("Vehicles")
                local inventoryRemote = inventoryEvents and inventoryEvents:FindFirstChild("GetPlayerInventory")
                local transfer = vehicleEvents and vehicleEvents:FindFirstChild("TransferInventoryItemToVehicle")
                local getVehicleItems = vehicleEvents and vehicleEvents:FindFirstChild("GetVehicleItems")
                if not inventoryRemote or not transfer or not transfer:IsA("RemoteFunction") or not getVehicleItems then
                    error("Potion transfer remotes are unavailable.")
                end
                local failures = {}
                while active(run) do
                    if State.AutoPlacePotions then error("Turn off Auto Place Potions before loading potions.") end
                    if State.InstantUnload then error("Turn off Instant Unload before loading potions.") end
                    local vehicle = GetMyVehicle()
                    if not vehicle then
                        task.wait(3)
                    else
                        local vehicleId = vehicle:GetAttribute("VehicleGUID") or vehicle:GetAttribute("GUID")
                            or LocalPlayer:GetAttribute("EquippedVehicle")
                        if not vehicleId or tostring(vehicleId) == "" then
                            task.wait(3)
                        else
                            local cargo = itemMap(getVehicleItems:InvokeServer(vehicleId))
                            if not active(run) then return end
                            if vehicleFull(vehicle, cargo) then error("Truck is full. Unload it before restarting Auto Load Potions.") end
                            local inventory = potionInventory(inventoryRemote:InvokeServer(), run)
                            if not active(run) then return end
                            local pending, cargoGuids = {}, {}
                            for guid, data in pairs(cargo) do
                                cargoGuids[tostring(guid)] = true
                                if type(data) == "table" then
                                    local itemGuid = readGuid(data)
                                    if itemGuid then cargoGuids[tostring(itemGuid)] = true end
                                    for name in pairs(wrappers) do
                                        local nestedGuid = readGuid(data[name])
                                        if nestedGuid then cargoGuids[nestedGuid] = true end
                                    end
                                end
                            end
                            for guid, data in pairs(inventory) do
                                if type(guid) == "string" and not cargoGuids[guid] then
                                    pending[#pending + 1] = guid
                                end
                            end
                            table.sort(pending)
                            if #pending > 0 then
                                local batch = {}
                                local capacity = tonumber(vehicle:GetAttribute("CargoCapacity"))
                                    or tonumber(vehicle:GetAttribute("ItemCapacity"))
                                    or tonumber(vehicle:GetAttribute("StorageCapacity"))
                                local batchLimit = 16
                                if capacity and capacity > 0 then
                                    local count = 0
                                    for _ in pairs(cargo) do count = count + 1 end
                                    batchLimit = math.min(batchLimit, math.max(0, capacity - count))
                                end
                                local limit = math.min(#pending, batchLimit)
                                local nextIndex, stopped, workerError = 1, false, nil
                                local workerCount = math.min(4, limit)
                                local remaining = workerCount
                                for worker = 1, workerCount do
                                    task.spawn(function()
                                        local workerOK, message = pcall(function()
                                            while active(run) and not stopped and nextIndex <= limit do
                                                if State.AutoPlacePotions or State.InstantUnload then
                                                    error("Turn off Auto Place Potions and Instant Unload before loading potions.")
                                                end
                                                if vehicleFull(vehicle, cargo) then stopped = true; break end
                                                -- Claim each GUID before yielding; at most four requests are in flight.
                                                local guid = pending[nextIndex]
                                                nextIndex = nextIndex + 1
                                                local requestOK, result = pcall(function()
                                                    return transfer:InvokeServer(guid)
                                                end)
                                                batch[#batch + 1] = {guid = guid, requestOK = requestOK, result = result}
                                                if not requestOK or result == false
                                                    or (type(result) == "table" and result.success == false) then
                                                    stopped = true
                                                end
                                            end
                                        end)
                                        if not workerOK then workerError = message; stopped = true end
                                        remaining = remaining - 1
                                    end)
                                end
                                -- Drain already-sent requests before an OFF/ON can start another run.
                                while remaining > 0 do task.wait(0.01) end
                                if not active(run) then return end
                                if workerError then error(workerError) end
                                local latest, allConfirmed
                                for attempt = 1, 3 do
                                    if attempt > 1 then task.wait(0.15) end
                                    if not active(run) then return end
                                    latest = itemMap(getVehicleItems:InvokeServer(vehicleId))
                                    if not active(run) then return end
                                    allConfirmed = true
                                    for _, item in ipairs(batch) do
                                        if not contains(latest, item.guid) then allConfirmed = false; break end
                                    end
                                    if allConfirmed then break end
                                    if vehicleFull(vehicle, latest) then error("Truck is full. Unload it before restarting Auto Load Potions.") end
                                end
                                for _, item in ipairs(batch) do
                                    if contains(latest, item.guid) then
                                        failures[item.guid] = nil
                                        loadedCount=loadedCount+1
                                        setStatus("Potions loaded and verified: "..loadedCount)
                                    else
                                        failures[item.guid] = (failures[item.guid] or 0) + 1
                                        local result = item.result
                                        local reason = type(result) == "table" and (result.message or result.error or result.reason)
                                            or type(result) == "string" and result or nil
                                        if failures[item.guid] >= 3 then
                                            error("Potion transfer was not confirmed after 3 attempts."
                                                .. (reason and (" " .. tostring(reason)) or " Check that your truck is spawned and has room."))
                                        end
                                        if not item.requestOK then warn("[Auto Load Potions] Transfer request failed.") end
                                    end
                                end
                                if vehicleFull(vehicle, latest) then error("Truck is full. Unload it before restarting Auto Load Potions.") end
                                if not allConfirmed then task.wait(0.75) end
                            else
                                task.wait(0.5)
                            end
                        end
                    end
                end
            end)
            running = false
            if active(run) then
                stop()
                if not ok then Notify("Auto Load Potions", tostring(message), 6) end
            elseif not HubDestroyed and State[key] then
                -- An OFF/ON during a server request resumes only after that request finishes.
                ensureWorker()
            end
        end)
    end

    CreateToggle(ShopPage, "Auto Load Potions", key, function(enabled)
        if HubDestroyed or enabled ~= State[key] then return end
        serial = serial + 1
        if enabled then ensureWorker() end
    end)
end)()
end

local function periodicToggle(label,key,getRemote,interval,args,stopOnReject)
    local serial=0
    CreateToggle(SHOP,label,key,function(enabled)
        if HubDestroyed or enabled~=State[key] then return end
        serial=serial+1
        local run=serial
        if not enabled then return end
        scheduler.spawn(function()
            while not HubDestroyed and authorized() and State[key] and run==serial do
                local object=getRemote()
                local ok,result=pcall(protectedCall,object,unpack(args or {}))
                if not ok then
                    ToggleObjects[key](false)
                    Notify(label,"Stopped: "..tostring(result))
                    return
                end
                if HubDestroyed or not authorized() or not State[key] or run~=serial then return end
                local rejected=result==false or (type(result)=="table" and result.success==false)
                if rejected and stopOnReject then
                    ToggleObjects[key](false)
                    Notify(label,"The server declined this request. Check your balance and eligibility.")
                    return
                end
                if result==true or (type(result)=="table" and result.success==true) then
                    setStatus(label..": server confirmed success.")
                end
                local deadline=scheduler.now()+interval
                while not HubDestroyed and authorized() and State[key] and run==serial and scheduler.now()<deadline do
                    scheduler.wait(math.min(0.25,math.max(0,deadline-scheduler.now())))
                end
            end
        end)
    end)
end
periodicToggle("Auto Collect Daily Rewards","AutoDailyRewards",function() return dailyRemote end,60,{})
periodicToggle("Auto Collect Museum Gift","AutoMuseumGift",function() return museumRemote end,300,{1})
periodicToggle("Auto Market Roll","AutoMarketRolling",function() return marketRemote end,0.75,{},true)

local function normalizeKey(value)
    if type(value)~="string" then return nil end
    local key=value:match("^%s*(.-)%s*$"):upper()
    local group=string.rep("%x",8)
    if key:match("^SYND%-"..group.."%-"..group.."%-"..group.."%-"..group.."$") then return key end
end
local function cacheName(id) return "SyndicateHub_Key_"..id..".json" end
local function readCache(id)
    local cached=environment.__SyndicateNativeKeys
    if type(cached)=="table" and normalizeKey(cached[id]) then return normalizeKey(cached[id]) end
    local readFile=pick(file,"read")
    if not readFile then return nil end
    local ok,text=pcall(readFile,cacheName(id))
    if not ok or type(text)~="string" or #text>4096 then return nil end
    local decoded,record=pcall(JSON.decode,text)
    if decoded and type(record)=="table" and tostring(record.userId)==id then return normalizeKey(record.key) end
end
local function saveCache(id,key)
    if type(environment.__SyndicateNativeKeys)~="table" then environment.__SyndicateNativeKeys={} end
    environment.__SyndicateNativeKeys[id]=key
    local writeFile=pick(file,"write")
    if writeFile then pcall(writeFile,cacheName(id),JSON.encode({userId=id,key=key})) end
end
local function clearCache(id)
    if not id then return end
    if type(environment.__SyndicateNativeKeys)=="table" then environment.__SyndicateNativeKeys[id]=nil end
    local remove=pick(file,"delete")
    if remove then pcall(remove,cacheName(id)) end
end
local function lock(message)
    auth.valid=false;auth.untilAt=0
    stopFeatures()
    if message then setStatus(message) end
end
local function verify(key,manual)
    if HubDestroyed or auth.busy then return end
    local id=currentIdentity()
    if not id or id~=identity then lock("Your loaded Roblox identity is unavailable or changed.");return end
    key=normalizeKey(key)
    if not key then
        if manual then lock("Enter a complete SYND member key.") end
        return
    end
    local post=pick(http,"Post","post")
    if not post then lock("Serotonin http.Post is unavailable; keys cannot be verified.");return end
    if manual then lock() end
    auth.generation=auth.generation+1
    local token=auth.generation
    auth.busy=true;auth.deadline=scheduler.now()+15;auth.pendingKey=key
    auth.nextCheck=scheduler.now()+60
    setStatus("Verifying your member key...")
    local body=JSON.encode({key=key,userId=id,sessionId=auth.sessionId,activity=manual and "launch" or "heartbeat"})
    local ok=pcall(post,ENDPOINT,{["Content-Type"]="application/json"},body,function(response)
        if HubDestroyed or token~=auth.generation then return end
        -- Keep IO callbacks small; decode and UI updates happen in onUpdate.
        auth.reply={token=token,id=id,body=response}
    end)
    if not ok then
        auth.busy=false;auth.generation=auth.generation+1
        if not authorized() then lock("Could not contact the key server. Your saved key is kept.") end
    end
end
local function processReply()
    local reply=auth.reply
    auth.reply=nil
    if not reply or reply.token~=auth.generation or reply.id~=identity then return end
    auth.busy=false
    if type(reply.body)~="string" or #reply.body>65536 then
        if not authorized() then lock("Key server response unavailable. Your saved key is kept.") end
        return
    end
    local ok,result=pcall(JSON.decode,reply.body)
    if not ok or type(result)~="table" or type(result.valid)~="boolean" then
        if not authorized() then lock("Key server response could not be verified. Your saved key is kept.") end
        return
    end
    if result.valid==true then
        auth.valid=true;auth.key=auth.pendingKey
        auth.untilAt=scheduler.now()+90;auth.nextCheck=scheduler.now()+60
        saveCache(identity,auth.key)
        setStatus("Key verified. Available Shop controls are unlocked.")
    else
        auth.key=nil
        clearCache(identity)
        lock("Key invalid, expired, revoked, or bound to another Roblox account.")
    end
end
local function showFeature(feature)
    if feature.available and not feature.created then
        uiAPI.check(TAB,SHOP,feature.label);owned(SHOP,feature.label)
        feature.created=true
        setValue(SHOP,feature.label,false)
    end
    if feature.created and uiAPI.visible then pcall(uiAPI.visible,TAB,SHOP,feature.label,feature.available and authorized()) end
end
local function refreshCapabilities()
    rawStorage=service("ReplicatedStorage")
    ReplicatedStorage=nodeProxy(rawStorage)
    inventoryRemote,hasInventory=remote({"Events","Inventory","GetPlayerInventory"})
    transferRemote,hasTransfer=remote({"Events","Vehicles","TransferInventoryItemToVehicle"})
    cargoRemote,hasCargo=remote({"Events","Vehicles","GetVehicleItems"})
    dailyRemote,hasDaily=remote({"Events","DailyReward","ClaimDailyReward"})
    museumRemote,hasMuseum=remote({"Events","Museum","Collect"})
    marketRemote,hasMarket=remote({"Events","HalloweenMarket","Roll"})
    capability.AutoLoadPotions=hasInventory and hasTransfer and hasCargo
    capability.AutoDailyRewards=hasDaily;capability.AutoMuseumGift=hasMuseum;capability.AutoMarketRolling=hasMarket
    local available={}
    for _,feature in ipairs(features) do
        feature.available=capability[feature.key]==true
        if not feature.available and State[feature.key] then ToggleObjects[feature.key](false) end
        showFeature(feature)
        if feature.available then available[#available+1]=feature.label end
    end
    local text=#available>0 and table.concat(available,", ")
        or "No callable game remotes exposed. Key access and Discord invite remain available."
    setValue(COMPAT,"Available Automation",text)
    return text
end
controller.handlers.verify=function()
    verify(uiAPI.get(TAB,ACCESS,"Member Key"),true)
end
controller.handlers.lock=function()
    auth.generation=auth.generation+1;auth.busy=false;auth.reply=nil;auth.key=nil
    lock("Locked. Your saved key is kept.")
end
controller.handlers.discord=function()
    local copy=pick(utility,"SetClipboard","setClipboard","set_clipboard")
    if copy then
        local ok=pcall(copy,INVITE)
        setStatus(ok and "Discord invite copied." or INVITE)
    else setStatus(INVITE) end
end
controller.handlers.refresh=function() report(refreshCapabilities()) end
controller.handlers.status=function()
    report("Build "..VERSION.." | "..statusText.." | "..refreshCapabilities())
end
controller.handlers.close=function()
    controller.Stop()
    print("[Syndicate / Serotonin] Native edition unloaded.")
end

local register=assert(pick(cheat,"register","Register"))
local lastPoll,lastSupport=0,-10
register("onUpdate",function()
    if HubDestroyed then return end
    local ok,message=pcall(function()
        local now=scheduler.now()
        if now-lastPoll<0.15 then return end
        lastPoll=now
        local id=currentIdentity()
        if id~=identity then
            identity=id;auth.generation=auth.generation+1;auth.busy=false;auth.reply=nil;auth.key=nil
            lock(id and "Roblox account found. Enter your member key." or "Join Storage Hunters with your Roblox account loaded.")
            if id then
                local ticks=(pick(utility,"GetTickCount","getTickCount","get_tick_count"))()
                auth.sessionId=string.format("%08x%08x%08x%08x",tonumber(id)%4294967296,
                    math.floor(ticks)%4294967296,math.random(0,16777215),math.random(0,16777215))
                local saved=readCache(id)
                if saved then setValue(ACCESS,"Member Key",saved);verify(saved,true) end
            end
        end
        if auth.reply then processReply() end
        if auth.busy and now>=auth.deadline then
            auth.generation=auth.generation+1;auth.busy=false
            if not authorized() then lock("Verification timed out. Your saved key is kept; click Verify Key to retry.") end
        end
        if auth.valid and (not id or id~=identity or now>auth.untilAt) then lock("Verification expired. Click Verify Key to reconnect.") end
        if auth.valid and not auth.busy and now>=auth.nextCheck then verify(auth.key,false) end
        if now-lastSupport>=2 then lastSupport=now;refreshCapabilities() end
        for _,feature in ipairs(features) do
            showFeature(feature)
            if feature.created then
                local value=uiAPI.get(TAB,SHOP,feature.label)==true
                if value and (not authorized() or not feature.available) then
                    value=false;setValue(SHOP,feature.label,false)
                end
                if value~=feature.value then
                    feature.value=value;State[feature.key]=value
                    scheduler.spawn(function()
                        if HubDestroyed then return end
                        local accepted,reason=pcall(feature.callback,value)
                        if not accepted then ToggleObjects[feature.key](false);Notify(feature.label,tostring(reason)) end
                    end)
                end
            end
        end
    end)
    if not ok then report("Native edition stopped: "..tostring(message));controller.Stop() end
end)
register("shutdown",controller.Stop)
register("newPlace",controller.Stop)
refreshCapabilities()
setStatus("Native Serotonin menu loaded. Enter your key under Member Access.")
print("[Syndicate / Serotonin] Compatibility build: "..VERSION.." | Open Serotonin's Syndicate Hub tab.")

