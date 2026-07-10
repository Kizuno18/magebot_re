


conts={}
creatures={}
self={}
finditem_pos=1
finditem_slot=1
MAXCONTAINERS=0
MAXCREATURES=0
SLOT_HEAD=1;
SLOT_AMMY=2;
SLOT_BACKPACK=3;
SLOT_ARMOR=4;
SLOT_HAND=5;
SLOT_HANDLEFT=6;
SLOT_LEGS=7;
SLOT_FEET=8;
SLOT_RING=9;
SLOT_AMMO=10;
if not script_loader_loaded then
local i=0;local j=0;
	for i=1,12 do 
		conts[i]={}
		conts[i].numitems=0
		conts[i].items={}
		for j=1,60 do
			conts[i].items[j]={}
		end
	end
	for i=1,300 do
		creatures[i]={}
	end

    printtext('*** script_loader loaded\n')

    function handle_error(err)
        print('\n--\n')
        PrintError(err)
        print(debug.traceback(err))
        print('\n--\n')
    end

    function init()    
        
        scriptlist = {}
        activescripts = {}

        real_require = require
        use_require_wrapper = true
        
        function print(...)
            local n = select('#', ...)
            for i=1,n do
                local v = select(i, ...)
                printtext(tostring(v))
                if n>1 and i<n then
                    printtext('\t')
                end
            end
            printtext('\n')
        end

        -- case insensitive require
        if use_require_wrapper then
            function require(s)
                --print('* require', s)
                return real_require(s:lower())
            end
        else
            require = real_require
        end
        
    end
    
    init()
	function FixCreatures()
	local c=1
	local g=1
	local a={GetCreatureInfo()}
	while (a[c]~=nil) do
		creatures[g].id=a[c]
		creatures[g].x=a[c+1]
		creatures[g].y=a[c+2]
		creatures[g].z=a[c+3]
		creatures[g].hp=a[c+4]
		creatures[g].movespeed=a[c+5]
		creatures[g].name=a[c+6]
		g=g+1
		c=c+7
	end
	MAXCREATURES=g-1
	end
	function Say(text)
		UseSpell(text)
	end
	
	function FixPlayer()
		local a={GetPlayerInfo()}
		self.id=a[1]
		self.x=a[2]
		self.y=a[3]
		self.z=a[4]
		self.sx=a[5]
		self.sy=a[6]
		self.hp=a[7]
		self.mp=a[8]
		self.hpmax=a[9]
		self.mpmax=a[10]
		self.condition=a[11]
		self.level=a[12]
		self.cap=a[13]
		self.exp=a[14]
		self.magiclevel=a[15]
		self.backpack=a[16]
		self.ring=a[17]
		self.ammy=a[18]
		self.arrow=a[19]
		self.arrowct=a[20]
		self.hand=a[21]
		self.handct=a[22]
		self.handleft=a[23]
		self.handleftct=a[24]
		self.boots=a[25]
		self.head=a[26]
		self.name=a[27]
	end
	function CastRuneXY(x,y,id)
		UseItemOnGround(x,y,id)
	end
	
	function GetGround(x,y)
		local a={GetGroundInfo(x,y)}
		return a
	end
	function GetTarget()
		local a={GetTargetInfo()}
		local target={}
		target.id=a[1]
		target.x=a[2]
		target.y=a[3]
		target.z=a[4]
		target.hp=a[5]
		target.movespeed=a[6]
		target.name=a[7]
		return target
	end
	function GetFollow()
		local a={GetFollowInfo()}
		local target={}
		target.id=a[1]
		target.x=a[2]
		target.y=a[3]
		target.z=a[4]
		target.hp=a[5]
		target.movespeed=a[6]
		target.name=a[7]
		return target
	end
	function GetCreatureData(id)
		local a={GetCreatureInt(id)}
		local target={}
		target.id=a[1]
		target.x=a[2]
		target.y=a[3]
		target.z=a[4]
		target.hp=a[5]
		target.movespeed=a[6]
		target.name=a[7]
		target.atk=a[8]
		target.iswalking=a[9]
		target.direction=a[10]
		target.outfit=a[11]
		target.outfithead=a[12]
		target.light=a[13]
		target.isvisible=a[14]
		target.skull=a[15]
		target.walkingx=a[16]
		target.walkingy=a[17]
		return target
	end
	function SelfNextToTile(x,y,z)
		if (math.abs(x-self.x)<2 and math.abs(y-self.y)<2 and self.z==z) then
			return 1;
		end
		return 0;
	end
	function SelfOnTile(x,y,z)
		if (self.x==x and self.y==y and self.z==z) then
			return 1;
		else
			return 0;
		end
	end
	function SetHardWaypoint(x,y,z)
		SetWaypointInfo(x,y,z,2)
	end
	function SetWarpWaypoint(x,y,z)
		SetWaypointInfo(x,y,z,1)
	end
	function SetWaypoint(x,y,z)
		SetWaypointInfo(x,y,z,0)
	end
	
	
	

	function FixContainers()
		finditem_pos=1
		finditem_slot=1
		local n=GetMaxContainers()
		local g=1
		local c=1
		while (g<(n+1)) do
			c=1
			local a={GetContainerItems(g-1)}
			if not next(a) then break end
			local num=a[c]
			local numitems=a[c+1]
			conts[g].numitems=numitems
			conts[g].contnum=num
			c=c+2
			conts[g].name=a[c]
			c=c+1
			local i=1
			while (i<numitems+1) do
				conts[g].items[i].id=a[c]
				conts[g].items[i].num=a[c+1]
				c=c+2
				i=i+1
			end
			g=g+1
		end
		conts.numconts=n
		MAXCONTAINERS=n
	end
	
	function FindItem(id)
		finditem_pos=1
		finditem_slot=1
		return FindNextItem(id)
	end
	
	function FindNextItem(id)
	local n=1
	local continfo={}
	while (finditem_pos<conts.numconts+1) do	
		local items=conts[finditem_pos].numitems
		while(finditem_slot<items+1) do
			if (conts[finditem_pos].items[finditem_slot].id==id) then
				continfo.num=conts[finditem_pos].contnum
				continfo.slot=finditem_slot-1
				continfo.quantity=conts[finditem_pos].items[finditem_slot].num
				finditem_slot=finditem_slot+1
				return continfo
			end
			finditem_slot=finditem_slot+1
		end
		finditem_pos=finditem_pos+1
		finditem_slot=1
	end
	finditem_pos=1
	return nil
	end
        
    function scriptloader(scriptname, scriptnum)
        print('scriptloader:', scriptnum, scriptname)
        local scriptenv = {}   -- a new table (one for each script)
        local scriptenv_mt = {__index=_G}  -- the metatable for scriptenv
        setmetatable (scriptenv, scriptenv_mt)
        
        local chunk, msg = loadfile(scriptname)      -- loads/compiles the lua chunk
        if (chunk ~=nil) then
            setfenv(chunk, scriptenv)    -- sets the 'global' env for the script
            local status, err = xpcall(chunk, handle_error)
            scriptlist[scriptnum]=scriptenv
        else
            PrintError(msg)
            return '{'..tostring(msg)..'}'
        end
        return scriptname .. " loaded"
    end

    function dotimercallback(name, num)            
        activescripts[tostring(num)] = true
        --printtext('<')
        -- reset active scripts when script_gui tick runs 
        -- utils tick happens before script_gui tick, since script_gui requires utils
        if num==0 and name=='GuiTick' then
            activescripts = {}
        end
        --print('dotimercallback:', num, name)
        --printtext(name)
        local f=scriptlist[num][name]        
        --print(type(f), num, name)
        local status, err = xpcall(f, handle_error)
        --printtext('>\n')
    end
    
    --function scriptloader(name, num)
    --    local fn = function() return scriptloader_real(name,num) end
    --    xpcall(fn, handle_error)
    --end

    --function dotimercallback(name, num)
    --    local fn = function() return dotimercallback_real(name,num) end
    --    xpcall(fn, handle_error)
    --end
    
    script_loader_loaded = true
    
end