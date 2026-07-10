--[[ 
--------Info------
To run scripts,
1.check the script[x] box
2.On your screen you should see @ All Scripts, F9 Hide/Show, F10 Reload 
3.Drag the @ to move this
4.Click on the scripts to turn them on/off
5.Click save to save your On list

Note: Pressing Escape pauses all scripts, the same as it pauses hotkeys
      You can resume them by clicking "Click to Unpause" on your screen or pressing F11

Note2: All keys and options are customizeable by editing script_gui.lua and script_loader.lua

--------Draw Functions---------

printtext(text)  //prints to dos console box
DrawText(text,x,y,color)

----------Action Functions---------//try to call only 1 per callback
AttackTarget(targetid)
FollowTarget(targetid)
CastHotkey(text)
CastRuneTarget(runeid,targetid)
CastRuneXY(x,y,runeid)
MoveTo(x,y)
UseSpell(text)                          //talking, casting spells ect
UseContainerItem(cont_number,item_slot,id)   //eating food,opening bp ect
UseInventoryItem(inv_slot,id)                //eating food,opening bp ect
UseGroundItem(x,y,id)                        //using ladders switches corpses ect.
UseItemOnGround(x,y,id)                      //using rope/shovel/rune ect from your bps to the ground

ThrowItemCtoC(cont_number,item_slot,cont_number2,item_slot2,id,amount)
ThrowItemCtoI(cont_number,item_slot,inv_slot,id,amount)
ThrowItemItoC(inv_slot,cont_number2,item_slot2,id,amount)
ThrowItemCtoG(cont_number,item_slot,x,y,id,amount)
ThrowItemGtoC(x,y,cont_number,item_slot,id,amount)
ThrowItemGtoG(x,y,x2,y2,id,amount)

NpcSay(text)
NpcBuy(id,amount)
NpcSell(id,amount)

---------Container/Ground Functions---------
FindItem(id) returns cinfo or nil        //1st one found //   cinfo.num,cinfo.slot,cinfo.quantity
FindNextItem(id) returns cinfo or nil    //next one
GetGround(x,y) returns table             //t[1]=id1 t[2]=quantity1 t[3]=id2 t[4]=quantity2 t[5]=id3 ect   Ex GetGround(self.x+1,self.y)

---------Waypoint Functions----------
SetWaypoint(x,y,z)          // Note:to use ropes or ladders, make sure to put a waypoint on the rope hole and the next waypoint above next to the hole
SetHardWaypoint(x,y,z)      // Tries to go to the exact location
SetWarpWaypoint(x,y,z)      // Use this for stairs/holes and warps
SetStopPoint()
ClearWaypoints()
StartWaypoints()
StopWaypoints()
SetHuntingOn(0 or 1)        // SetHuntingOn(1) player hunts while doing waypoints

StartAutoExplorer(floors)   // Ex StartAutoExplorer(-2)=down 2 floors, StartAutoExplorer(0)=just the current floor
StopAutoExplorer()

--------More Global Functions----------
setTimerCallback(function)         //you need this if you want your script to persist
GetScriptPause() returns 1 or 0    //1 if scripts were paused
GetGround(x,y) returns idlist      //Ex GetGround(self.x+1,self.y)
IsKeyDown(number) returns number //accepts virtual key codes returns 0 if not pressed
SetManaPotIDS(normalmana,strongmana,greatmana,paladinmana)      // for use by the healer if your otserver has custom ids 0 means dont change
SetHealPotIDS(normalheal,strongheal,greatheal,paladinheal)      // Same as SetManaPotIDS
SetRuneIDS(ITEM_UH,ITEM_SD,ITEM_GFB,ITEM_MWALL,ITEM_ROPE)                 // Ex SetRuneIDS(3160,0,0,0,0) this changes the UH rune to 3160 
SetLootTimer(time_in_ms)                                                  // Ex SetLootTimer(240)

-------Extras------
PlaySound("filename.wav") or PlaySound("Beep")
SetClipboard(text)

-----------GetCreatureData(id)---------
local target=GetCreatureData(id)
target.x
target.y
target.z
target.hp
target.movespeed
target.name
target.atk
target.iswalking
target.direction
target.outfit
target.outfithead
target.light
target.isvisible
target.skull
target.walkingx
target.walkingy

-----------target/follow----------
target=GetTarget() or target=GetFollow()
target.name
target.id
target.x
target.y
target.z
target.hp
target.movespeed

-----------self------------
self.name
self.x
self.y
self.z
self.id
self.sx
self.sy
self.hp
self.mp
self.hpmax
self.mpmax
self.condition
self.level
self.cap
self.exp
self.magiclevel
self.backpack
self.ring
self.ammy
self.arrow
self.arrowct
self.hand
self.handct
self.handleft
self.handleftct

----------creatures[MAXCREATURES]---------

creatures[i]
creatures[i].id
creatures[i].x
creatures[i].y
creatures[i].z
creatures[i].hp
creatures[i].movespeed
creatures[i].name
}

---------conts[MAXCONTAINERS]---------

conts[i].contnum
conts[i].name
conts[i].numitems
conts[i].items[j].id
conts[i].items[j].num

-------inventory------
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

]]--
print("sample loaded")
