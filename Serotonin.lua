-- Syndicate Hub: experimental Serotonin callback-scheduler and native-HTTP launcher.
-- Run this file directly from the executor's scripting menu if its usual loadstring fails.
-- This cannot supply Roblox APIs that the executor does not implement.
local URL = "https://raw.githubusercontent.com/ThatOneThing91/Syndicate-Hub/main/StorageHunters"

local function report(message)
    local text = "[Syndicate / Serotonin] " .. tostring(message)
    if type(warn) == "function" then warn(text) else print(text) end
    pcall(function()
        game:GetService("StarterGui"):SetCore("SendNotification", {
            Title = "Syndicate Hub", Text = tostring(message), Duration = 12,
        })
    end)
    return false
end

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

local function schedulerForHub()
    local native = type(task) == "table" and task or {}
    local waitFunction = type(native.wait) == "function" and native.wait
        or type(wait) == "function" and wait or nil
    local spawnFunction = type(native.spawn) == "function" and native.spawn
        or type(spawn) == "function" and spawn or nil
    if not waitFunction or not spawnFunction then
        local scheduler, reason = callbackTaskScheduler()
        if not scheduler then report(reason); return nil end
        print("[Syndicate / Serotonin] Using Serotonin's callback scheduler.")
        return scheduler
    end
    local scheduler = {}
    for name, fn in pairs(native) do scheduler[name] = fn end
    scheduler.wait = waitFunction
    scheduler.spawn = spawnFunction
    local unpackArguments = table.unpack or unpack
    if type(scheduler.delay) ~= "function" then
        scheduler.delay = function(seconds, callback, ...)
            local args, count = {...}, select("#", ...)
            return spawnFunction(function()
                waitFunction(math.max(0, tonumber(seconds) or 0))
                return callback(unpackArguments(args, 1, count))
            end)
        end
    end
    if type(scheduler.defer) ~= "function" then
        scheduler.defer = function(callback, ...)
            return scheduler.delay(0, callback, ...)
        end
    end
    if type(scheduler.cancel) ~= "function" then
        scheduler.cancel = function(thread)
            if type(coroutine.close) == "function" and type(thread) == "thread" then
                return coroutine.close(thread)
            end
            error("Native thread cancellation is unavailable; hub loops stop through their shutdown flags.")
        end
    end
    return scheduler
end

local function httpRequestForHub(scheduler)
    local candidates = {request, http_request,
        type(syn) == "table" and syn.request or false,
        type(http) == "table" and http.request or false,
        type(fluxus) == "table" and fluxus.request or false}
    -- Use explicit indices: sparse native-function lists must not stop at the first nil.
    for index=1,5 do
        if type(candidates[index]) == "function" then return candidates[index] end
    end
    local get = type(http) == "table" and (http.Get or http.get)
    local post = type(http) == "table" and (http.Post or http.post)
    if type(get) ~= "function" or type(post) ~= "function" then return nil end
    return function(options)
        local method = tostring(options.Method or "GET"):upper()
        local completed, body, status = false, nil, nil
        local function receive(response)
            if completed then return end
            if type(response) == "table" then
                body=response.Body or response.body
                status=tonumber(response.StatusCode or response.Status or response.status)
            else
                body=response
            end
            completed=true
        end
        if method == "GET" then
            get(options.Url, options.Headers or {}, receive)
        elseif method == "POST" then
            post(options.Url, options.Headers or {}, options.Body or "", receive)
        else
            error("Serotonin HTTP adapter only supports GET and POST.")
        end
        local elapsed=0
        while not completed and elapsed < 15 do
            elapsed=elapsed+math.max(0.01,tonumber(scheduler.wait(0.01)) or 0.01)
        end
        if not completed then
            completed=true
            return {StatusCode=504,Body="",TransportStatusUnavailable=true}
        end
        if type(body) ~= "string" then
            return {StatusCode=status or 503,Body="",TransportStatusUnavailable=status==nil}
        end
        if not status and method == "POST" then
            -- The documented callback exposes a body, not an HTTP status.
            -- Accept only our key server's explicit valid=true/false application response.
            local decoded, result=pcall(function()
                return game:GetService("HttpService"):JSONDecode(body)
            end)
            if options.Url == "https://syndicate-auth.loganmatthewsmall.workers.dev/verify"
                and decoded and type(result) == "table" and type(result.valid) == "boolean" then
                return {StatusCode=200,Body=body,TransportStatusUnavailable=true}
            end
            return {StatusCode=503,Body=body,TransportStatusUnavailable=true}
        end
        return {StatusCode=status or 200,Body=body,TransportStatusUnavailable=status==nil}
    end
end

-- Translate the syntax used by this hub; strings and comments are left untouched.
local function translateHubSyntax(source)
    local tokens, edits, blocks, loops, declarations = {}, {}, {}, {}, {}
    local index, size = 1, #source
    local function addEdit(first, last, replacement)
        edits[#edits+1] = {first=first,last=last,text=replacement}
    end
    while index <= size do
        local char = source:sub(index,index)
        if char:match("%s") then
            index=index+1
        elseif source:sub(index,index+1) == "--" then
            local equals=source:sub(index+2):match("^%[(=*)%[")
            if equals then
                local closing="]"..equals.."]"
                local finish=source:find(closing,index+4+#equals,true)
                if not finish then error("Unclosed long comment.") end
                index=finish+#closing
            else
                index=source:find("\n",index+2,true) or (size+1)
            end
        elseif char == '"' or char == "'" then
            local quote=char
            index=index+1
            while index<=size do
                local c=source:sub(index,index)
                if c=="\\" then index=index+2
                elseif c==quote then index=index+1;break
                else index=index+1 end
            end
        elseif char=="[" and source:sub(index):match("^%[(=*)%[") then
            local equals=source:sub(index):match("^%[(=*)%[")
            local closing="]"..equals.."]"
            local finish=source:find(closing,index+2+#equals,true)
            if not finish then error("Unclosed long string.") end
            index=finish+#closing
        else
            local word=source:sub(index):match("^[%a_][%w_]*")
            local two=source:sub(index,index+1)
            local value=word or ((two=="+=" or two=="-=" or two=="*=" or two=="/=" or two=="%=") and two) or char
            tokens[#tokens+1]={value=value,first=index,last=index+#value-1}
            index=index+#value
        end
    end
    local function enclosingLoop()
        for n=#blocks,1,-1 do
            local block=blocks[n]
            if block.kind=="function" then return nil end
            if block.kind=="loop" or block.kind=="repeat" then return block end
        end
    end
    local compoundCount, continueCount=0,0
    for number,token in ipairs(tokens) do
        local value=token.value
        if value=="local" and #blocks==0 then
            local nextToken=tokens[number+1]
            local names, cursor={},number+1
            local isFunction=nextToken and nextToken.value=="function"
            if isFunction then cursor=cursor+1 end
            while tokens[cursor] and tokens[cursor].value:match("^[%a_][%w_]*$") do
                names[#names+1]=tokens[cursor].value
                cursor=cursor+1
                if not tokens[cursor] or tokens[cursor].value~="," then break end
                cursor=cursor+1
            end
            if #names>0 then declarations[#declarations+1]={token=token,names=names,
                eligible=isFunction or (tokens[cursor] and tokens[cursor].value=="=")} end
        end
        if value=="function" then
            blocks[#blocks+1]={kind="function"}
        elseif value=="if" then
            blocks[#blocks+1]={kind="if"}
        elseif value=="for" or value=="while" then
            blocks[#blocks+1]={kind="pendingLoop",breaks={},continues={}}
        elseif value=="repeat" then
            local block={kind="repeat",breaks={},continues={}}
            blocks[#blocks+1]=block;loops[#loops+1]=block
        elseif value=="do" then
            local block=blocks[#blocks]
            if block and block.kind=="pendingLoop" then
                block.kind,block.open="loop",token
                loops[#loops+1]=block
            else
                blocks[#blocks+1]={kind="do"}
            end
        elseif value=="end" or value=="until" then
            local block=blocks[#blocks]
            if not block then error("Unbalanced block near byte "..token.first) end
            if value=="until" and block.kind~="repeat" then error("Unexpected until.") end
            block.close=token
            blocks[#blocks]=nil
        elseif value=="continue" or value=="break" then
            local block=enclosingLoop()
            if not block then error("Loop control outside a loop.") end
            local list=value=="continue" and block.continues or block.breaks
            list[#list+1]=token
        elseif value=="+=" or value=="-=" or value=="*=" or value=="/=" or value=="%=" then
            local last=number-1
            if not tokens[last] or not tokens[last].value:match("^[%a_][%w_]*$") then
                error("Unsupported compound-assignment target.")
            end
            local first=last
            while first>=3 and tokens[first-1].value=="."
                and tokens[first-2].value:match("^[%a_][%w_]*$") do first=first-2 end
            local lineStart=(source:sub(1,tokens[first].first-1):match(".*()\n") or 0)+1
            if not source:sub(lineStart,tokens[first].first-1):match("^%s*$") then
                error("Unsupported inline compound assignment.")
            end
            local lineEnd=source:find("\n",token.last+1,true) or (#source+1)
            local rhs=source:sub(token.last+1,lineEnd-1):match("^%s*(.-)%s*$")
            if not rhs:match("^[%w_%.]+$") then error("Compound assignment needs an explicit expression port.") end
            local lhs=source:sub(tokens[first].first,tokens[last].last)
            addEdit(token.first,token.last,"= "..lhs.." "..value:sub(1,1))
            compoundCount=compoundCount+1
        end
    end
    if #blocks~=0 then error("Unclosed block in downloaded hub.") end
    for number,block in ipairs(loops) do
        if #block.continues>0 then
            if block.kind=="repeat" then error("Repeat-loop continue needs an explicit port.") end
            local flag="__syndicateLoopBreak"..number
            addEdit(block.open.last+1,block.open.last," local "..flag.." = false repeat ")
            addEdit(block.close.first,block.close.first-1," until true if "..flag.." then break end ")
            for _,token in ipairs(block.continues) do
                addEdit(token.first,token.last,"do break end")
                continueCount=continueCount+1
            end
            for _,token in ipairs(block.breaks) do
                addEdit(token.first,token.last,"do "..flag.." = true; break end")
            end
        end
    end
    -- Lua 5.1 has a lower active-local ceiling than this Luau hub.
    -- Move only unique, outermost declarations into an isolated function environment.
    local counts, firstUse, moved={},{},0
    for _,token in ipairs(tokens) do
        if not firstUse[token.value] then firstUse[token.value]=token.first end
    end
    for _,decl in ipairs(declarations) do
        for _,name in ipairs(decl.names) do counts[name]=(counts[name] or 0)+1 end
    end
    if #declarations>150 then
        for _,decl in ipairs(declarations) do
            local unique=decl.eligible
            for _,name in ipairs(decl.names) do
                if counts[name]~=1 or firstUse[name]<decl.token.first then unique=false end
            end
            if unique and moved<80 then
                addEdit(decl.token.first,decl.token.last,"")
                moved=moved+1
            end
        end
    end
    table.sort(edits,function(a,b) return a.first<b.first end)
    local output, position={},1
    for _,edit in ipairs(edits) do
        if edit.first<position then error("Overlapping compatibility edits.") end
        output[#output+1]=source:sub(position,edit.first-1)
        output[#output+1]=edit.text
        position=edit.last+1
    end
    output[#output+1]=source:sub(position)
    return table.concat(output),compoundCount,continueCount,moved
end

local function main()
    local ok, players = pcall(function() return game:GetService("Players") end)
    if not ok or not players then
        return report("This runtime does not expose Roblox game:GetService. The full hub needs an in-game Luau runtime; changing the download link cannot add that support.")
    end
    if not Instance or type(Instance.new) ~= "function" then
        return report("This runtime does not expose Instance.new, which the hub needs to create its menu.")
    end
    local scheduler = schedulerForHub()
    if not scheduler then return false end
    scheduler.spawn(function()
        local startupOK, result = pcall(function()
    local compile = loadstring
    if type(compile) ~= "function" then
        return report("loadstring is unavailable in this runtime. The original hub cannot be compiled here.")
    end

    local requestFunction = httpRequestForHub(scheduler)
    if not requestFunction then
        return report("No HTTP transport is available: expected a native request API or Serotonin http.Get/http.Post.")
    end

    local source, errors = nil, {}
    local function accept(body)
        if type(body) ~= "string" or #body == 0 then return false end
        local prefix = body:match("^%s*(.-)[\r\n]") or body
        if prefix:lower():find("<!doctype", 1, true) or prefix:lower():find("<html", 1, true) then
            return false
        end
        source = body
        return true
    end
    local downloaded, body = pcall(function() return game:HttpGet(URL) end)
    if not downloaded or not accept(body) then
        errors[#errors + 1] = "game:HttpGet failed"
        local success, response = pcall(requestFunction, {Url = URL, Method = "GET"})
        local status = success and type(response) == "table"
            and tonumber(response.StatusCode or response.Status) or nil
        if not (status == 200 and accept(response.Body)) then
            errors[#errors+1] = "HTTP adapter failed" .. (status and (" (HTTP " .. status .. ")") or "")
        end
    end
    if not source then
        return report("Could not download the hub: " .. table.concat(errors, "; "))
    end
    local translated, compounds, continues, moved = translateHubSyntax(source)
    source = translated
    print("[Syndicate / Serotonin] Translated " .. compounds .. " compound assignments and " .. continues .. " continue statements.")
    if moved > 0 and (type(setfenv) ~= "function" or type(getfenv) ~= "function") then
        return report("Lua 5.1 compatibility requires setfenv/getfenv to isolate the hub's state.")
    end
    -- Pass the scheduler as a local parameter; do not overwrite executor globals.
    local wrappedSource = "return function(task, request)\n" .. source .. "\nend"
    local success, chunk, compileError = pcall(compile, wrappedSource, "=SyndicateHub")
    if not success or type(chunk) ~= "function" then
        return report("The hub could not compile in this runtime: " .. tostring(success and compileError or chunk))
    end
    if moved > 0 then
        local base = getfenv(1)
        local scope = setmetatable({}, {__index=base})
        scope._G = type(base._G) == "table" and base._G or base
        setfenv(chunk, scope)
    end
    local constructed, launch = pcall(chunk)
    if not constructed or type(launch) ~= "function" then
        return report("Could not prepare the hub: " .. tostring(launch))
    end
    scheduler.spawn(function()
        local executed, runtimeError = pcall(launch, scheduler, requestFunction)
        if not executed then
            if scheduler.stop then scheduler.stop() end
            report("The hub stopped during startup: " .. tostring(runtimeError))
        end
    end)
    return true
        end)
        if not startupOK then report("Bootstrap stopped: " .. tostring(result)) end
        if not startupOK or result == false then
            if scheduler.stop then scheduler.stop() end
        end
    end)
    return true
end

print("[Syndicate / Serotonin] Compatibility build: syntax-3")
local ok, result = pcall(main)
if not ok then report("Compatibility check failed: " .. tostring(result)) end
