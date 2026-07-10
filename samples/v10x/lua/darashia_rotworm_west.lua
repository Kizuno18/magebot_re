SetTimerCallback("darashia_rot_w")
local state=0
local script_start=os.clock()
local state_text={"unloaded","going to cave","opening","going in","hunting","going to bank","depositing"}
function darashia_rot_w()
DrawText("Status:" .. tostring(state) .. ":" .. state_text[state+1],50,200,0xFFDDEE22)
DrawText("Time Running:" .. tostring(math.floor(os.clock()-script_start)),5,220,0xFFDDEE22)
if (state==0) then
	SetWaypoint(33207,32465,8)
	SetWaypoint(33210,32461,8)
	SetWaypoint(33214,32456,8)
	SetWarpWaypoint(33214,32454,8)
	SetWaypoint(33209,32449,7)
	SetWaypoint(33202,32449,7)
	SetWaypoint(33195,32449,7)
	SetWaypoint(33188,32449,7)
	SetWaypoint(33181,32449,7)
	SetWaypoint(33174,32449,7)
	SetWaypoint(33135,32434,7)
	SetHardWaypoint(33133,32433,7)
	SetStopPoint()
	StartWaypoints()
	state=1;
end
if ((state==1 or state==2) and SelfNextToTile(33133,32432,7)==1) then
	UseItemOnGround(33133,32432,3457)
	Sleep(400)
	state=state+1
end
if (state==3 or (self.x<33175 and self.x>33101 and self.y>32400 and self.y<32460 and self.z>7 and state<3)) then
	if (self.z==7) then
		MoveTo(33133,32432,7)
		Sleep(200)
	else
		StartAutoExplorer(-1)
		CastHotkey("EXORIMAX")
		SetAutoLoot(1)
		state=4
	end
end
if (state==4 and os.clock()-script_start>8600) then
	script_start=os.clock()
	if (SelfNextToTile(33133,32432,8)==1 or SelfNextToTile(33132,32432,8)==1 or SelfNextToTile(33132,32431,8)==1) then 
	StopAutoExplorer()
	UseItemOnGround(33133,32432,3003)
	Sleep(400)
	end
end
if (state==4 and self.z==7) then
	state=5
	ClearWaypoints()
	SetWaypoint(33140,32435,7)
	SetWaypoint(33190,32405,7)
	SetWaypoint(33209,32403,7)
	SetWaypoint(33215,32402,7)
	SetWaypoint(33216,32396,7)
	SetWaypoint(33217,32390,7)
	--SetWaypoint(33220,32387,7)
	SetHardWaypoint(33221,32387,7)
	SetStopPoint()
	StartWaypoints()
end
if (state==5 and SelfOnTile(33221,32387,7)==1) then
	ClearWaypoints()
	Say("hi")
	Sleep(800)
	NpcSay("deposit all")
	Sleep(400)
	NpcSay("yes")
	Sleep(100)
	SetWaypoint(33217,32390,7)
	SetWaypoint(33216,32396,7)
	SetWaypoint(33215,32402,7)
	SetWaypoint(33209,32403,7)
	SetWaypoint(33135,32434,7)
	SetHardWaypoint(33133,32433,7)
	SetStopPoint()
	StartWaypoints()
	state=1
end
end
	