local top=669;local topleft=485;local script_loaded=1;                                                                                                       --|
                                                                                                    --|
-- mb modifies this file when you move the script gui --
-- the first line goes to 160 chars, dont change that --

-- v01 - whatever existed before

require 'utils' -- important hack: force utils tick to be associated with this script so it is never unloaded

local ctr=0
local a={}
local key_minus = 189
local key_equal = 187
local key_f9 = 0x78
local key_f10 = 0x79
local key_tilde = 0xC0
local key, reloadkey
key=key_f9;
reloadkey=key_f10;
local lmouse=0
local toggle_timer=os.clock()
local save_timer=os.clock()-4000
local reloading=0
local movegui=0
local CLOCK
print('gui')
local speedcontainers=4
local speedcreatures=3
local speedplayer=1

function GuiTick()
    CLOCK=os.clock()
    ctr=ctr+1
	if (ctr%speedcontainers==0) then
	FixContainers()
	end
	if (ctr%speedcreatures==0) then
	FixCreatures()
	end
	if (ctr%speedplayer==0) then
	FixPlayer()
	end
    local i=1
    if (ctr==10) then
        local fileinfo={LoadFile("script_gui_backup.txt")}
        while (i<#fileinfo) do
            if (tonumber(fileinfo[i+1])==1) then
                EnableScript(fileinfo[i])
            else
				--DisableScript(fileinfo[i])
            end
            i=i+2
        end
    end
	if (IsKeyDown(key_tilde)~=0) then
		ResumeScripts()
	end

    if (IsKeyDown(reloadkey)~=0) then
        reloading=1
    else
        if (reloading==1) then
            print('*** reloading lua...')
            ReloadLua()            
            print('*** reloading lua complete')            
            reloading=0
        end
    end

    if (IsKeyDown(key)~=0 and CLOCK-toggle_timer>1.2) then
        toggle_timer=CLOCK
        script_loaded= ((script_loaded+1)%2)
        SetGuiParams(top,topleft,script_loaded)
    end

    --if (script_loaded==0) then return end

    local lmouseclick=0
    if (IsKeyDown(0x01)~=0) then
        if (lmouse==0) then lmouseclick=1 end
        lmouse=1
    else
        movegui=0
        if (lmouse==1) then lmouse=2 else lmouse=0 end
    end

    local a={ListScripts()}
    local len=#a
    if (CLOCK-save_timer<1.5) then
        a[len+1]="Saving";a[len+2]=1
    else
        a[len+1]="Click to Save"
        a[len+2]=0
    end
    i=1
    local sz=6
    local cc=0
    local posX, posY = GetCursorX(), GetCursorY()
    local filebuf="";
    --DrawBox(topleft-5,top-5,sz*30,#a*sz+20,0xFF222222)
    local moveguicolor=0xFF11EEDD
	local unpausecolor=0xFFEEEE22
	local paused=GetScriptPause()
	if (posX<(34*sz)+topleft and posX>topleft+1*sz and posY<top+(1)*sz and posY>top-sz and paused==1) then
		unpausecolor=0xFFDD22CC
		if (lmouseclick==1) then
			ResumeScripts()
		end
	end
	if (paused==0) then
    DrawText("All Scripts, F9 Hide/Show, F10 Reload",topleft,top-sz,0xFF11EEDD);
	else
	DrawText("Click ~ Resume, F9 Hide/Show, F10 Reload",topleft,top-sz,unpausecolor);
	end
    if (posX<(1*sz)+topleft and posX>topleft-2*sz-2 and posY<top+(1)*sz and posY>top-sz) then
        moveguicolor=0xFFDDDD11
        if (lmouseclick==1) then
            movegui=1;
        end
    end
    if (movegui==1) then
        topleft=posX+1+sz
        top=posY
        SetGuiParams(top,topleft,script_loaded) -- grr
    end
    DrawText("@",topleft-2*sz-2,top-sz,moveguicolor);
    if (script_loaded==0) then return end
    while (i<#a) do
        local rows_per_col = 40
        local col_width = 200
        local line_height = sz*2
        local col = math.floor(i/(rows_per_col*2))
        local row = i % (rows_per_col*2)
        local textx = topleft + col*col_width
        local texty = top+row*sz

        local saver=0
        if (i==#a-1) then
            saver=1
        else
            filebuf=filebuf .. a[i] .. "\r\n" .. a[i+1] .. "\r\n"
        end

        --DrawBox(textx+2, texty, col_width-4, 1, 0xFFFF0000)
        --if (posX<(string.len(a[i])+5)*sz+topleft and posX>topleft and posY<top+(i+2)*sz and posY>top+i*sz) then
        if (posX>textx and posX<textx+col_width and posY>texty and posY<texty+line_height) then
            if (lmouse==2) then
                if (a[i+1]==1) then
                    if (saver==0) then
                        DisableScript(a[i])
                    end
                else
                    if (saver==1) then
                        SaveFile("script_gui_backup.txt",filebuf);
                        save_timer=CLOCK
                    else
                        EnableScript(a[i])
                    end
                end
            end
            --local info=GetScriptInfo(a[i])
            --DrawText(info,topleft+200,top+i*sz,0xFFDDEE00);
            cc=0xFF
        else
            cc=0
        end
        if (saver==1) then cc=0xFFFF end
        if (a[i+1]==1) then
            DrawText("ON  " .. a[i],textx,texty, 0xFF33EE00+cc);
        else
            DrawText("OFF " .. a[i],textx,texty, 0xFFFF0000+cc);
        end
        i=i+2        
    end
end

SetTimerCallback("GuiTick")