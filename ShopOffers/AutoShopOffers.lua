-- Syndicate Hub optional module: Auto Shop Offers (isolated from hub startup).
-- RespondOffer(offerGuid, bool) is known; incoming offer schema is not confirmed.
-- V3: prioritize ShowOffer / OfferPresented and record their payload shape.
-- Do not decide when there is no reliable offer percentage.
return function(cfg)
    assert(type(cfg)=="table" and typeof(cfg.parent)=="Instance","Shop page required")
    local ReplicatedStorage=game:GetService("ReplicatedStorage")
    local InputService=game:GetService("UserInputService")
    local parent=cfg.parent
    local purple=cfg.theme or Color3.fromRGB(153,102,204)
    local bg=cfg.background or Color3.fromRGB(35,35,39)
    local dark=cfg.darker or Color3.fromRGB(18,18,21)
    local white=cfg.foreground or Color3.fromRGB(240,240,240)
    local muted=cfg.muted or Color3.fromRGB(160,160,165)
    local off=cfg.offColor or Color3.fromRGB(55,55,60)
    local connections={}
    local listeners={}
    local active=false
    local closed=false
    local percent=0
    local decided={}
    local pendingIds={}
    local guiHandled={}
    local lastGui={}
    local eventCount=0
    local lastEventName=""
    local watchedNames={}
    local offerEventTraces={}
    local eventCounts={}
    local lastOfferSignal=nil
    local function create(class,properties,parentObject)
        local item=Instance.new(class)
        for key,value in pairs(properties) do item[key]=value end
        item.Parent=parentObject
        return item
    end
    local function corner(item,n)
        create("UICorner",{CornerRadius=UDim.new(0,n or 7)},item)
    end
    local function watch(collection,signal,callback)
        local c=signal:Connect(callback)
        collection[#collection+1]=c
    end
    local function frame(height)
        local f=create("Frame",{
            Size=UDim2.new(1,-8,0,height),
            BackgroundColor3=bg,BorderSizePixel=0
        },parent)
        corner(f)
        return f
    end
    local line=frame(42)
    create("TextLabel",{
        Size=UDim2.new(1,-82,1,0),Position=UDim2.fromOffset(12,0),
        BackgroundTransparency=1,Text="Auto Shop Offers",
        TextColor3=white,TextSize=13,Font=Enum.Font.GothamMedium,
        TextXAlignment=Enum.TextXAlignment.Left
    },line)
    local toggle=create("TextButton",{
        Size=UDim2.fromOffset(58,28),
        Position=UDim2.new(1,-68,.5,-14),
        BackgroundColor3=off,TextColor3=white,Text="OFF",
        TextSize=11,Font=Enum.Font.GothamBold,BorderSizePixel=0
    },line)
    corner(toggle,14)
    local adjust=frame(69)
    local info=create("TextLabel",{
        Position=UDim2.fromOffset(12,3),Size=UDim2.new(1,-24,0,18),
        BackgroundTransparency=1,Text="Accept at or above selected % of item value",
        TextColor3=muted,TextSize=10,Font=Enum.Font.Gotham,
        TextXAlignment=Enum.TextXAlignment.Left
    },adjust)
    local minus=create("TextButton",{
        Position=UDim2.fromOffset(12,26),Size=UDim2.fromOffset(36,32),
        BackgroundColor3=dark,TextColor3=white,Text="-",
        TextSize=18,Font=Enum.Font.GothamBold,BorderSizePixel=0
    },adjust)
    corner(minus,6)
    local plus=create("TextButton",{
        Position=UDim2.new(1,-48,0,26),Size=UDim2.fromOffset(36,32),
        BackgroundColor3=dark,TextColor3=white,Text="+",
        TextSize=18,Font=Enum.Font.GothamBold,BorderSizePixel=0
    },adjust)
    corner(plus,6)
    local edit=create("TextBox",{
        Position=UDim2.new(.5,-45,0,26),Size=UDim2.fromOffset(90,32),
        BackgroundColor3=dark,TextColor3=white,Text="0%",
        TextSize=13,Font=Enum.Font.GothamBold,BorderSizePixel=0,
        ClearTextOnFocus=false,TextXAlignment=Enum.TextXAlignment.Center
    },adjust)
    corner(edit,6)
    local status=frame(52)
    local statusText=create("TextLabel",{
        Position=UDim2.fromOffset(12,0),Size=UDim2.new(1,-24,0,23),
        BackgroundTransparency=1,Text="OFF · Requires a verifiable offer percentage",
        TextColor3=muted,TextSize=10,Font=Enum.Font.Gotham,
        TextXAlignment=Enum.TextXAlignment.Left,
        TextTruncate=Enum.TextTruncate.AtEnd
    },status)
    local diagnose=create("TextButton",{
        Position=UDim2.new(1,-118,0,25),Size=UDim2.fromOffset(106,22),
        BackgroundColor3=dark,TextColor3=white,Text="SCAN OFFER",
        TextSize=10,Font=Enum.Font.GothamBold,BorderSizePixel=0
    },status)
    corner(diagnose,5)
    local hint=create("TextLabel",{
        Position=UDim2.fromOffset(12,25),Size=UDim2.new(1,-140,0,22),
        BackgroundTransparency=1,Text="Detects offers in game UI and remotes",
        TextColor3=muted,TextSize=10,Font=Enum.Font.Gotham,
        TextXAlignment=Enum.TextXAlignment.Left,
        TextTruncate=Enum.TextTruncate.AtEnd
    },status)
    local function setPercent(value)
        value=tonumber(value)
        if not value or value~=value then value=percent end
        percent=math.clamp(math.floor(value+.5),-100,100)
        edit.Text=(percent>0 and "+" or "")..tostring(percent).."%"
    end
    setPercent(0)
    watch(connections,minus.Activated,function()
        if not closed then setPercent(percent-5) end
    end)
    watch(connections,plus.Activated,function()
        if not closed then setPercent(percent+5) end
    end)
    watch(connections,edit.FocusLost,function()
        if not closed then
            setPercent(tonumber(edit.Text:match("[+-]?%d+")))
        end
    end)
    local function uuid(v)
        return type(v)=="string" and
            v:match("^[%x]+%-%x+%-%x+%-%x+%-%x+$")~=nil
    end
    local function field(tbl,names)
        if type(tbl)~="table" then return nil end
        for _,name in ipairs(names) do
            local found=rawget(tbl,name)
            if found~=nil then return found end
        end
    end
    local function num(n)
        if type(n)=="number" then return n end
        if type(n)=="string" then
            local clean=n:gsub("[$,%s]","")
            return tonumber(clean)
        end
    end
    local ids={"offerId","OfferId","OfferID","offerGuid","OfferGuid","OfferUUID","offerUUID",
        "CustomerOfferId","customerOfferId","OfferIdentifier","guid","Guid","GUID","id","Id","UUID"}
    local prices={"offerPrice","OfferPrice","offeredPrice","OfferedPrice","offerAmount","OfferAmount",
        "BidAmount","bidAmount","PriceOffered","priceOffered","CurrentOffer","currentOffer","offerValue"}
    local values={"itemValue","ItemValue","marketValue","MarketValue","baseValue","BaseValue",
        "listedPrice","ListedPrice","Price","OriginalValue","originalValue","askingPrice","AskingPrice",
        "ItemWorth","itemWorth","ActualValue","actualValue"}
    local diffs={"differencePercent","DifferencePercent","percentageDifference","PercentageDifference",
        "offerDifferencePercent","OfferDifferencePercent","OfferPercentDifference",
        "profitPercent","ProfitPercent","PriceDifferencePercent","priceDifferencePercent",
        "percentAboveValue","PercentAboveValue"}
    local function difference(tbl)
        local price=num(field(tbl,prices))
        local worth=num(field(tbl,values))
        if price and worth and worth>0 and price>=0 then
            return (price/worth-1)*100
        end
        return num(field(tbl,diffs))
    end
    local function stopListeners()
        for _,connection in ipairs(listeners) do
            pcall(function() connection:Disconnect() end)
        end
        listeners={}
    end
    local function handleOffer(id,pct)
        if not active or closed or not uuid(id) then return end
        if type(pct)~="number" or pct~=pct or
            pct< -100 or pct>1000 or decided[id] then return end
        local events=ReplicatedStorage:FindFirstChild("Events")
        local shopper=events and events:FindFirstChild("NPCShopper")
        local remote=shopper and shopper:FindFirstChild("RespondOffer")
        if not remote or not remote:IsA("RemoteEvent") then return end
        decided[id]=true
        pendingIds[id]=nil
        local accept=pct>=percent
        local ok,err=pcall(function() remote:FireServer(id,accept) end)
        if ok then
            statusText.Text=(accept and "Sent ACCEPT · " or "Sent DECLINE · ")..
                tostring(math.floor(pct+.5)).."%"
        else
            decided[id]=nil
            statusText.Text="Response error · See executor log"
            warn("[Syndicate Auto Shop Offers] "..tostring(err))
        end
    end
    local function inspect(tbl,inherited,depth,seen)
        if type(tbl)~="table" or depth>4 or seen[tbl] then return end
        seen[tbl]=true
        local id=field(tbl,ids)
        if not uuid(id) then id=inherited end
        local diff=difference(tbl)
        if uuid(id) then
            if not decided[id] then pendingIds[id]=os.clock() end
            if diff then handleOffer(id,diff) end
        end
        for _,item in pairs(tbl) do
            if type(item)=="table" then inspect(item,id,depth+1,seen) end
        end
    end
    local function describeArgument(value,depth,visited)
        local kind=typeof(value)
        if kind=="Instance" then
            return kind.."("..value.ClassName..":"..value.Name:sub(1,55)..")"
        end
        if type(value)=="table" then
            if depth>=3 or visited[value] then return "{...}" end
            visited[value]=true
            local chunks={}
            local n=0
            for key,entry in pairs(value) do
                n=n+1
                if n>25 then chunks[#chunks+1]="...";break end
                local k=tostring(key):sub(1,45)
                chunks[#chunks+1]=k.."="..
                    describeArgument(entry,depth+1,visited)
            end
            table.sort(chunks)
            return "{"..table.concat(chunks,", "):sub(1,1500).."}"
        end
        if type(value)=="string" then
            return string.format("%q",value:sub(1,160))
        end
        return tostring(value)
    end
    local function traceEvent(sourceName,...)
        -- Only record offer lifecycle events; no spam from cash/tip effects.
        if sourceName~="ShowOffer" and sourceName~="OfferPresented"
            and sourceName~="HideOffer" then return end
        local n=select("#",...)
        local detail={}
        local args={...}
        for i=1,math.min(n,12) do
            detail[#detail+1]="arg"..i.."="..
                describeArgument(args[i],0,{})
        end
        local record=tostring(sourceName).." ("..n.." args): "..
            table.concat(detail," | ")
        offerEventTraces[#offerEventTraces+1]=record
        if #offerEventTraces>16 then table.remove(offerEventTraces,1) end
        lastOfferSignal=sourceName
        -- Keep the console diagnostics readable and bounded.
        print("[Auto Shop Offers] "..record:sub(1,1700))
    end
    local function readEvent(sourceName,...)
        if not active then return end
        eventCount=eventCount+1
        lastEventName=tostring(sourceName)
        eventCounts[sourceName]=(eventCounts[sourceName] or 0)+1
        traceEvent(sourceName,...)
        if sourceName=="HideOffer" then
            pendingIds={}
            guiHandled={}
            statusText.Text="Offer closed; waiting for next customer"
            return
        end
        local args={...}
        local possibleId=nil
        for _,arg in ipairs(args) do
            if uuid(arg) then possibleId=arg end
        end
        if possibleId and not decided[possibleId] then
            pendingIds[possibleId]=os.clock()
        end
        local seen={}
        for _,arg in ipairs(args) do
            if type(arg)=="table" then inspect(arg,possibleId,0,seen) end
        end
        if (sourceName=="ShowOffer" or sourceName=="OfferPresented")
            and not possibleId then
            statusText.Text=sourceName.." received; checking offer details..."
        end
        -- Without known field names, raw numbers could mean prices,
        -- customer stats or percentages. Don't guess argument order.
    end
    -- Other NPCShopper scripts sometimes show the offer only through
    -- the customer's GUI, not an NPCShopper OnClientEvent. Observe visible
    -- Accept / Decline controls and their offer comparison.
    local player=game:GetService("Players").LocalPlayer
    local guiCache={}
    local function visible(item)
        local node=item
        while node do
            if node:IsA("GuiObject") and not node.Visible then return false end
            if node:IsA("LayerCollector") and not node.Enabled then return false end
            node=node.Parent
        end
        return true
    end
    local function parseMoney(value)
        if type(value)~="string" then return nil end
        local raw=value:match("%$%s*([%d,%.]+%s*[kKmMbBtT]?)")
        if not raw then return nil end
        local amount,suffix=raw:match("([%d,%.]+)%s*([kKmMbBtT]?)")
        if not amount then return nil end
        local cleaned=amount:gsub(",","")
        local v=tonumber(cleaned)
        if not v then return nil end
        local mult={k=1e3,m=1e6,b=1e9,t=1e12}
        return v*(mult[suffix:lower()] or 1)
    end
    local function signedPercent(value)
        if type(value)~="string" then return nil end
        local s=value:gsub("−","-"):gsub("＋","+")
        local raw=s:match("([+-]%s*%d+%.?%d*)%s*%%")
        return raw and tonumber(raw:gsub("%s+","")) or nil
    end
    local function buttonLabel(node)
        if node:IsA("TextButton") then
            return (node.Text.." "..node.Name):lower()
        end
        local label=node:FindFirstChildWhichIsA("TextLabel",true)
        return (node.Name.." "..(label and label.Text or "")):lower()
    end
    local function readGuiOffer(container)
        local labels,acceptButton,declineButton,guiId={},nil,nil,nil
        for _,node in ipairs(container:GetDescendants()) do
            if node:IsA("GuiObject") and visible(node) then
                if node:IsA("TextLabel") or node:IsA("TextButton") or
                    node:IsA("TextBox") then
                    if node.Text~="" then labels[#labels+1]=node.Text end
                end
                if node:IsA("GuiButton") then
                    local value=buttonLabel(node)
                    if (value:find("accept",1,true) or
                        value:find("agree",1,true) or
                        value:match("^yes%s") or value:match("%syes%s")) and
                        not acceptButton then acceptButton=node end
                    if (value:find("decline",1,true) or
                        value:find("reject",1,true) or
                        value:find("refuse",1,true) or value:match("%sno%s")) and
                        not declineButton then declineButton=node end
                end
            end
            -- Offer GUIDs can live on a frame, a button, or a StringValue.
            if not guiId then
                if node:IsA("StringValue") and uuid(node.Value) then
                    guiId=node.Value
                else
                    for key,val in pairs(node:GetAttributes()) do
                        local k=key:lower()
                        if uuid(val) and (k:find("offer",1,true) or
                            k:find("shopper",1,true) or k=="guid") then
                            guiId=val
                            break
                        end
                    end
                end
            end
        end
        if not (acceptButton and declineButton) then return nil end
        for key,val in pairs(container:GetAttributes()) do
            if uuid(val) and (key:lower():find("offer",1,true) or
                key:lower():find("shopper",1,true)) then
                guiId=val; break
            end
        end
        local pct,offered,worth=nil,nil,nil
        for _,str in ipairs(labels) do
            local sign=signedPercent(str)
            if sign~=nil and pct==nil then pct=sign end
            local lower=str:lower()
            local offerPos=lower:find("offer",1,true) or
                lower:find("bid",1,true)
            local worthPos=lower:find("worth",1,true) or
                lower:find("value",1,true) or
                lower:find("estimated",1,true)
            if offerPos then
                offered=offered or parseMoney(str:sub(offerPos))
            end
            if worthPos then
                worth=worth or parseMoney(str:sub(worthPos))
            end
        end
        if pct==nil and offered and worth and worth>0 then
            pct=(offered/worth-1)*100
        end
        local count=#labels
        return {container=container,accept=acceptButton,
            decline=declineButton,id=guiId,pct=pct,labels=labels,
            count=count,offered=offered,worth=worth}
    end
    local function guiOffers()
        local pg=player and player:FindFirstChild("PlayerGui")
        if not pg then return {} end
        local output,seen={},{}
        for _,node in ipairs(pg:GetDescendants()) do
            if node:IsA("GuiButton") and visible(node) then
                local label=buttonLabel(node)
                local candidate=label:find("accept",1,true) or
                    label:find("agree",1,true) or
                    label:match("^yes%s") or label:match("%syes%s")
                if candidate then
                local p=node.Parent
                for k=1,5 do
                    if not p or p==pg then break end
                    if p:IsA("GuiObject") and not seen[p] then
                        local data=readGuiOffer(p)
                        if data then
                            output[#output+1]=data
                            seen[p]=true
                            break
                        end
                    end
                    p=p.Parent
                end
                end
            end
        end
        -- A shopper GUI may have nested copies of the same dialog.
        local unique={}
        local result={}
        for _,candidate in ipairs(output) do
            if not unique[candidate.accept] then
                unique[candidate.accept]=true
                result[#result+1]=candidate
            end
        end
        return result
    end
    local function pendingSingleId()
        local id,count=nil,0
        local now=os.clock()
        for guid,receivedAt in pairs(pendingIds) do
            if decided[guid] or now-receivedAt>8 then
                pendingIds[guid]=nil
            else
                count=count+1
                id=guid
            end
        end
        return count==1 and id or nil
    end
    local function clickNative(button)
        -- Executor-safe non-pointer dispatch: don't click unrelated screen
        -- coordinates, move the cursor, or interfere with controller input.
        if type(firesignal)=="function" then
            local success=pcall(function() firesignal(button.Activated) end)
            if success then return true,"firesignal" end
        end
        if type(getconnections)=="function" then
            local success,items=pcall(getconnections,button.Activated)
            if success and type(items)=="table" and #items>0 then
                local fired=0
                for _,item in ipairs(items) do
                    if type(item.Fire)=="function" then
                        local okay=pcall(function() item:Fire() end)
                        if okay then fired=fired+1 end
                    end
                end
                if fired>0 then return true,"getconnections" end
            end
        end
        return false,"Native button dispatch unavailable; need incoming offer ID"
    end
    local lastGuiSeen=0
    local function pollOfferGui()
        local dialogs=guiOffers()
        lastGui=dialogs
        if #dialogs==0 then guiHandled={} end
        if #dialogs~=1 then return end
        local d=dialogs[1]
        if not d.pct then
            statusText.Text="Offer popup found; missing % / item value"
            return
        end
        if d.pct~=d.pct or d.pct < -100 or d.pct>1000 then return end
        local id=d.id or pendingSingleId()
        if id then
            handleOffer(id,d.pct)
            return
        end
        -- No remotely visible offer UUID: use the game's own Accept/Decline
        -- UI handlers rather than inventing a UUID or guessing remote args.
        local choice=d.pct>=percent
        local target=choice and d.accept or d.decline
        local key=tostring(target)..":"..
            tostring(math.floor(d.pct*10+.5)/10)..":"..
            table.concat(d.labels,"|")
        if guiHandled[key] and os.clock()-guiHandled[key]<25 then return end
        local ok,how=clickNative(target)
        if ok then
            guiHandled[key]=os.clock()
            statusText.Text=(choice and "Sent GUI accept " or "Sent GUI decline ")..
                tostring(math.floor(d.pct+.5)).."% ("..how..")"
        else
            statusText.Text="Offer visible; "..how
        end
    end
    watch(connections,diagnose.Activated,function()
        if closed then return end
        local dialogs=guiOffers()
        local lines={
            "[Auto Shop Offers] Diagnostics",
            "Toggle: "..tostring(active).." / target: "..tostring(percent).."%",
            "Events seen: "..tostring(eventCount)..
                " / last event: "..lastEventName,
            "OfferPresented seen: "..tostring(eventCounts.OfferPresented or 0)..
                ", ShowOffer seen: "..tostring(eventCounts.ShowOffer or 0)..
                ", HideOffer seen: "..tostring(eventCounts.HideOffer or 0),
            "Offer-related remotes: "..table.concat(watchedNames,", "),
            "Visible offer dialogs: "..tostring(#dialogs),
            "Pending remote IDs: "..tostring((function()
                local n=0 for _ in pairs(pendingIds) do n=n+1 end return n end)())
        }
        for i,d in ipairs(dialogs) do
            lines[#lines+1]="Dialog "..i.." ["..d.container:GetFullName()..
                "], guid="..tostring(d.id)..", percent="..tostring(d.pct)
            for j=1,math.min(#d.labels,20) do
                lines[#lines+1]="   "..tostring(d.labels[j]):sub(1,120)
            end
        end
        if #offerEventTraces>0 then
            lines[#lines+1]="Recent incoming offer payloads:"
            for _,trace in ipairs(offerEventTraces) do
                lines[#lines+1]=trace
            end
        else
            lines[#lines+1]="No ShowOffer / OfferPresented events captured while ON."
        end
        -- If the game's controls have different names, collect a small
        -- sample of visible offer/customer UI elements for the next fix.
        local pg=player and player:FindFirstChild("PlayerGui")
        if pg then
            local count=0
            for _,node in ipairs(pg:GetDescendants()) do
                if count>=28 then break end
                if node:IsA("GuiObject") and visible(node) then
                    local value=(node:IsA("TextLabel") or
                        node:IsA("TextButton") or node:IsA("TextBox")) and
                        node.Text or ""
                    local lower=(node.Name.." "..value):lower()
                    if lower:find("offer",1,true) or
                       lower:find("shopper",1,true) or
                       lower:find("customer",1,true) or
                       lower:find("accept",1,true) or
                       lower:find("decline",1,true) then
                        count=count+1
                        lines[#lines+1]="GUI "..node:GetFullName():sub(-140)..
                            " | "..tostring(value):sub(1,120)
                    end
                end
            end
        end
        local output=table.concat(lines,"\n")
        print(output)
        local clip=setclipboard or toclipboard
        if type(clip)=="function" then
            pcall(clip,output)
            statusText.Text="Diagnostic copied. Send the SCAN OFFER output."
        else
            statusText.Text="Diagnostic printed to executor console."
        end
    end)
    local function subscribe()
        local events=ReplicatedStorage:FindFirstChild("Events")
        local shopper=events and events:FindFirstChild("NPCShopper")
        if not shopper then
            statusText.Text="NPCShopper events unavailable"
            return false
        end
        local reply=shopper:FindFirstChild("RespondOffer")
        if not reply or not reply:IsA("RemoteEvent") then
            statusText.Text="RespondOffer remote unavailable"
            return false
        end
        watchedNames={}
        eventCount=0
        eventCounts={}
        offerEventTraces={}
        lastOfferSignal=nil
        local watched={}
        local function attach(remote)
            if not remote:IsA("RemoteEvent") or
                remote==reply or watched[remote] then return end
            local lower=remote.Name:lower()
            -- Watch every NPCShopper event and related seller/customer events
            -- elsewhere under ReplicatedStorage.Events.
            if not remote:IsDescendantOf(shopper) and
                not (lower:find("offer",1,true) or
                     lower:find("shopper",1,true) or
                     lower:find("customer",1,true)) then return end
            watched[remote]=true
            watchedNames[#watchedNames+1]=remote:GetFullName()
            watch(listeners,remote.OnClientEvent,function(...)
                readEvent(remote.Name,...)
            end)
        end
        for _,remote in ipairs(events:GetDescendants()) do attach(remote) end
        watch(listeners,events.DescendantAdded,attach)
        local presented=shopper:FindFirstChild("OfferPresented")
        local shown=shopper:FindFirstChild("ShowOffer")
        local hidden=shopper:FindFirstChild("HideOffer")
        statusText.Text=(presented and shown and hidden)
            and "Listening to ShowOffer / OfferPresented / HideOffer"
            or "Some shopper lifecycle remotes are missing"
        task.spawn(function()
            while not closed and active do
                local ok,problem=pcall(pollOfferGui)
                if not ok and os.clock()-lastGuiSeen>5 then
                    lastGuiSeen=os.clock()
                    warn("[Auto Shop Offers] GUI detection: "..tostring(problem))
                end
                task.wait(.35)
            end
        end)
        return true
    end
    watch(connections,toggle.Activated,function()
        if closed then return end
        if active then
            active=false
            stopListeners()
            statusText.Text="OFF · Requires a verifiable offer percentage"
        else
            active=subscribe()
        end
        toggle.Text=active and "ON" or "OFF"
        toggle.BackgroundColor3=active and purple or off
    end)
    local controller={}
    function controller:Destroy()
        if closed then return end
        closed=true; active=false
        stopListeners()
        for _,connection in ipairs(connections) do
            pcall(function() connection:Disconnect() end)
        end
        for _,item in ipairs({line,adjust,status}) do pcall(function() item:Destroy() end) end
    end
    return controller
end
