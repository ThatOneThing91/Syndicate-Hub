-- Syndicate Hub optional module: Auto Shop Offers (isolated from hub startup).
-- RespondOffer(offerGuid, bool) is known; incoming offer schema is not confirmed.
-- V2: detect offer data from events AND the visible customer offer GUI.
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
        "percentAboveValue","PercentAboveValue","percentage","Percentage"}
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
    local function readEvent(sourceName,...)
        if not active then return end
        eventCount=eventCount+1
        lastEventName=tostring(sourceName)
        local args={...}
        local possibleId=nil
        local numeric={}
        for _,arg in ipairs(args) do
            if uuid(arg) then possibleId=arg end
            if type(arg)=="number" then numeric[#numeric+1]=arg end
        end
        if possibleId and not decided[possibleId] then pendingIds[possibleId]=os.clock() end
        local seen={}
        for _,arg in ipairs(args) do
            if type(arg)=="table" then inspect(arg,possibleId,0,seen) end
        end
        -- Positional (UUID, offer price, fair item value) is valid only with
        -- exactly two distinct positive numeric fields; no blind single value.
        if possibleId and #numeric==2 and numeric[1]>=0 and numeric[2]>0 then
            local delta=(numeric[1]/numeric[2]-1)*100
            handleOffer(possibleId,delta)
        end
    end
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
        local function attach(remote)
            if remote:IsA("RemoteEvent") and remote~=reply then
                watch(listeners,remote.OnClientEvent,readEvent)
            end
        end
        for _,remote in ipairs(shopper:GetDescendants()) do attach(remote) end
        watch(listeners,shopper.DescendantAdded,attach)
        statusText.Text="ON · Watching incoming offers with known values"
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
