local CLOCK
local gptimer=os.clock()-.40
local monstertable={"Rotworm",3198,"Hero",3155,"Warlock",3155,"Cave Rat",3198}
function RuneMonstersEx()
	CLOCK=os.clock()
	if (CLOCK-gptimer<.4) then return 0; end
	gptimer=CLOCK
	local target=GetTarget()
	local i=1
	while (monstertable[i]~=nil) do
		if (target.name==monstertable[i]) then
			CastRuneTarget(monstertable[i+1],target.id)
			return
		end
		i=i+2
	end	
end
	
	
SetTimerCallback("RuneMonstersEx")