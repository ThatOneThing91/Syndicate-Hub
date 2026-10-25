-- Syndicate Hub: Serotonin compatibility launcher.
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

local function main()
    local ok, players = pcall(function() return game:GetService("Players") end)
    if not ok or not players then
        return report("This runtime does not expose Roblox game:GetService. The full hub needs an in-game Luau runtime; changing the download link cannot add that support.")
    end
    if not Instance or type(Instance.new) ~= "function" then
        return report("This runtime does not expose Instance.new, which the hub needs to create its menu.")
    end
    if not task or type(task.wait) ~= "function" or type(task.spawn) ~= "function" then
        return report("This runtime is missing Roblox task.wait/task.spawn, which the hub needs.")
    end
    local compile = loadstring
    if type(compile) ~= "function" then
        return report("loadstring is unavailable in this runtime. The original hub cannot be compiled here.")
    end

    -- Key verification requires a POST-capable request API as well as downloading.
    local candidates = {
        {label = "request", fn = request},
        {label = "http_request", fn = http_request},
        {label = "syn.request", fn = type(syn) == "table" and syn.request or nil},
        {label = "http.request", fn = type(http) == "table" and http.request or nil},
        {label = "fluxus.request", fn = type(fluxus) == "table" and fluxus.request or nil},
    }
    local hasRequest = false
    for _, candidate in ipairs(candidates) do
        if type(candidate.fn) == "function" then hasRequest = true; break end
    end
    if not hasRequest then
        return report("No supported HTTP request API is available. Server key verification needs POST requests; this launcher cannot bypass that requirement.")
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
        local used = {}
        for _, candidate in ipairs(candidates) do
            if type(candidate.fn) == "function" and not used[candidate.fn] then
                used[candidate.fn] = true
                local success, response = pcall(candidate.fn, {Url = URL, Method = "GET"})
                local status = success and type(response) == "table"
                    and tonumber(response.StatusCode or response.Status) or nil
                if status == 200 and accept(response.Body) then break end
                errors[#errors + 1] = candidate.label .. " failed" .. (status and (" (HTTP " .. status .. ")") or "")
            end
        end
    end
    if not source then
        return report("Could not download the hub: " .. table.concat(errors, "; "))
    end
    local success, chunk, compileError = pcall(compile, source, "=SyndicateHub")
    if not success or type(chunk) ~= "function" then
        return report("The hub could not compile in this runtime: " .. tostring(success and compileError or chunk))
    end
    local executed, runtimeError = pcall(chunk)
    if not executed then
        return report("The hub stopped during startup: " .. tostring(runtimeError))
    end
    return true
end

local ok, result = pcall(main)
if not ok then report("Compatibility check failed: " .. tostring(result)) end
