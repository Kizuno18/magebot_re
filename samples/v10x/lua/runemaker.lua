local CLOCK
local gptimer=os.clock()-.40
local mana_req=2800
local spell_req="adori mas flam"
local oldhand=0
function runemaker()
	CLOCK=os.clock()
	if (CLOCK-gptimer<2.2) then return 0; end
	gptimer=CLOCK
	local hand=self.hand
	if (hand==3147 and self.mp>mana_req) then
		UseSpell(spell_req)
		Sleep(200)
		return
	end
	if (oldhand~=0 and hand~=oldhand) then
		local gp=FindItem(oldhand)
		if (gp~=nil) then
			ThrowItemCtoI(gp.num,gp.slot,SLOT_HAND,oldhand,1)
			Sleep(300)
			return
		end
	end
	if (hand~=3147 and self.mp>mana_req) then
		oldhand=hand
		local gp=FindItem(3147)
		if (gp~=nil) then
			print("moving")
			ThrowItemCtoI(gp.num,gp.slot,SLOT_HAND,3147,1)
			return
		end
	end
end
	
	
SetTimerCallback("runemaker")