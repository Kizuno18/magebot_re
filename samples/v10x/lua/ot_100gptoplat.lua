local CLOCK
local gptimer=os.clock()-.40
function gptoplat()
	CLOCK=os.clock()
	local id=3031
	if (CLOCK-gptimer<1.2) then return 0; end
	gptimer=CLOCK
	local gp=FindItem(id)
	while (gp~=nil) do
		if (gp.quantity==100) then		
			UseContainerItem(gp.num,gp.slot,id)
			return 0;
		end
		gp=FindNextItem(id)
	end
	id=3035
	local gp=FindItem(id)
	while (gp~=nil) do
		if (gp.quantity==100) then		
			UseContainerItem(gp.num,gp.slot,id)
			return 0;
		end
		gp=FindNextItem(id)
	end
end
	
	
SetTimerCallback("gptoplat")