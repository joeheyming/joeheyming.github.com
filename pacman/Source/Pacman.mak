# Microsoft Developer Studio Generated NMAKE File, Based on Pacman.dsp
!IF "$(CFG)" == ""
CFG=Pacman - Win32 Debug
!MESSAGE No configuration specified. Defaulting to Pacman - Win32 Debug.
!ENDIF 

!IF "$(CFG)" != "Pacman - Win32 Release" && "$(CFG)" != "Pacman - Win32 Debug"
!MESSAGE Invalid configuration "$(CFG)" specified.
!MESSAGE You can specify a configuration when running NMAKE
!MESSAGE by defining the macro CFG on the command line. For example:
!MESSAGE 
!MESSAGE NMAKE /f "Pacman.mak" CFG="Pacman - Win32 Debug"
!MESSAGE 
!MESSAGE Possible choices for configuration are:
!MESSAGE 
!MESSAGE "Pacman - Win32 Release" (based on "Win32 (x86) Console Application")
!MESSAGE "Pacman - Win32 Debug" (based on "Win32 (x86) Console Application")
!MESSAGE 
!ERROR An invalid configuration is specified.
!ENDIF 

!IF "$(OS)" == "Windows_NT"
NULL=
!ELSE 
NULL=nul
!ENDIF 

!IF  "$(CFG)" == "Pacman - Win32 Release"

OUTDIR=.\Release
INTDIR=.\Release
# Begin Custom Macros
OutDir=.\Release
# End Custom Macros

ALL : "$(OUTDIR)\Pacman.exe"


CLEAN :
	-@erase "$(INTDIR)\Camera.obj"
	-@erase "$(INTDIR)\Character.obj"
	-@erase "$(INTDIR)\Dot.obj"
	-@erase "$(INTDIR)\Environment.obj"
	-@erase "$(INTDIR)\Floor.obj"
	-@erase "$(INTDIR)\Game.obj"
	-@erase "$(INTDIR)\Ghost.obj"
	-@erase "$(INTDIR)\KeyBinder.obj"
	-@erase "$(INTDIR)\Level.obj"
	-@erase "$(INTDIR)\Object.obj"
	-@erase "$(INTDIR)\Pacman.obj"
	-@erase "$(INTDIR)\PacmanGame.obj"
	-@erase "$(INTDIR)\PriorityQueue.obj"
	-@erase "$(INTDIR)\Terrain.obj"
	-@erase "$(INTDIR)\vc60.idb"
	-@erase "$(INTDIR)\Vector.obj"
	-@erase "$(OUTDIR)\Pacman.exe"

"$(OUTDIR)" :
    if not exist "$(OUTDIR)/$(NULL)" mkdir "$(OUTDIR)"

CPP=cl.exe
CPP_PROJ=/nologo /ML /W3 /GX /O2 /D "WIN32" /D "NDEBUG" /D "_CONSOLE" /D "_MBCS" /Fp"$(INTDIR)\Pacman.pch" /YX /Fo"$(INTDIR)\\" /Fd"$(INTDIR)\\" /FD /c 

.c{$(INTDIR)}.obj::
   $(CPP) @<<
   $(CPP_PROJ) $< 
<<

.cpp{$(INTDIR)}.obj::
   $(CPP) @<<
   $(CPP_PROJ) $< 
<<

.cxx{$(INTDIR)}.obj::
   $(CPP) @<<
   $(CPP_PROJ) $< 
<<

.c{$(INTDIR)}.sbr::
   $(CPP) @<<
   $(CPP_PROJ) $< 
<<

.cpp{$(INTDIR)}.sbr::
   $(CPP) @<<
   $(CPP_PROJ) $< 
<<

.cxx{$(INTDIR)}.sbr::
   $(CPP) @<<
   $(CPP_PROJ) $< 
<<

RSC=rc.exe
BSC32=bscmake.exe
BSC32_FLAGS=/nologo /o"$(OUTDIR)\Pacman.bsc" 
BSC32_SBRS= \
	
LINK32=link.exe
LINK32_FLAGS=kernel32.lib user32.lib gdi32.lib winspool.lib comdlg32.lib advapi32.lib shell32.lib ole32.lib oleaut32.lib uuid.lib odbc32.lib odbccp32.lib kernel32.lib user32.lib gdi32.lib winspool.lib comdlg32.lib advapi32.lib shell32.lib ole32.lib oleaut32.lib uuid.lib odbc32.lib odbccp32.lib /nologo /subsystem:console /incremental:no /pdb:"$(OUTDIR)\Pacman.pdb" /machine:I386 /out:"$(OUTDIR)\Pacman.exe" 
LINK32_OBJS= \
	"$(INTDIR)\Camera.obj" \
	"$(INTDIR)\Character.obj" \
	"$(INTDIR)\Dot.obj" \
	"$(INTDIR)\Environment.obj" \
	"$(INTDIR)\Floor.obj" \
	"$(INTDIR)\Game.obj" \
	"$(INTDIR)\Ghost.obj" \
	"$(INTDIR)\KeyBinder.obj" \
	"$(INTDIR)\Level.obj" \
	"$(INTDIR)\Object.obj" \
	"$(INTDIR)\Pacman.obj" \
	"$(INTDIR)\PacmanGame.obj" \
	"$(INTDIR)\PriorityQueue.obj" \
	"$(INTDIR)\Terrain.obj" \
	"$(INTDIR)\Vector.obj"

"$(OUTDIR)\Pacman.exe" : "$(OUTDIR)" $(DEF_FILE) $(LINK32_OBJS)
    $(LINK32) @<<
  $(LINK32_FLAGS) $(LINK32_OBJS)
<<

!ELSEIF  "$(CFG)" == "Pacman - Win32 Debug"

OUTDIR=.\Debug
INTDIR=.\Debug
# Begin Custom Macros
OutDir=.\Debug
# End Custom Macros

ALL : "$(OUTDIR)\Pacman.exe"


CLEAN :
	-@erase "$(INTDIR)\Camera.obj"
	-@erase "$(INTDIR)\Character.obj"
	-@erase "$(INTDIR)\Dot.obj"
	-@erase "$(INTDIR)\Environment.obj"
	-@erase "$(INTDIR)\Floor.obj"
	-@erase "$(INTDIR)\Game.obj"
	-@erase "$(INTDIR)\Ghost.obj"
	-@erase "$(INTDIR)\KeyBinder.obj"
	-@erase "$(INTDIR)\Level.obj"
	-@erase "$(INTDIR)\Object.obj"
	-@erase "$(INTDIR)\Pacman.obj"
	-@erase "$(INTDIR)\PacmanGame.obj"
	-@erase "$(INTDIR)\PriorityQueue.obj"
	-@erase "$(INTDIR)\Terrain.obj"
	-@erase "$(INTDIR)\vc60.idb"
	-@erase "$(INTDIR)\vc60.pdb"
	-@erase "$(INTDIR)\Vector.obj"
	-@erase "$(OUTDIR)\Pacman.exe"
	-@erase "$(OUTDIR)\Pacman.ilk"
	-@erase "$(OUTDIR)\Pacman.pdb"

"$(OUTDIR)" :
    if not exist "$(OUTDIR)/$(NULL)" mkdir "$(OUTDIR)"

CPP=cl.exe
CPP_PROJ=/nologo /MLd /W3 /Gm /GX /ZI /Od /D "WIN32" /D "_DEBUG" /D "_CONSOLE" /D "_MBCS" /Fp"$(INTDIR)\Pacman.pch" /YX /Fo"$(INTDIR)\\" /Fd"$(INTDIR)\\" /FD /GZ /c 

.c{$(INTDIR)}.obj::
   $(CPP) @<<
   $(CPP_PROJ) $< 
<<

.cpp{$(INTDIR)}.obj::
   $(CPP) @<<
   $(CPP_PROJ) $< 
<<

.cxx{$(INTDIR)}.obj::
   $(CPP) @<<
   $(CPP_PROJ) $< 
<<

.c{$(INTDIR)}.sbr::
   $(CPP) @<<
   $(CPP_PROJ) $< 
<<

.cpp{$(INTDIR)}.sbr::
   $(CPP) @<<
   $(CPP_PROJ) $< 
<<

.cxx{$(INTDIR)}.sbr::
   $(CPP) @<<
   $(CPP_PROJ) $< 
<<

RSC=rc.exe
BSC32=bscmake.exe
BSC32_FLAGS=/nologo /o"$(OUTDIR)\Pacman.bsc" 
BSC32_SBRS= \
	
LINK32=link.exe
LINK32_FLAGS=kernel32.lib user32.lib gdi32.lib winspool.lib comdlg32.lib advapi32.lib shell32.lib ole32.lib oleaut32.lib uuid.lib odbc32.lib odbccp32.lib kernel32.lib user32.lib gdi32.lib winspool.lib comdlg32.lib advapi32.lib shell32.lib ole32.lib oleaut32.lib uuid.lib odbc32.lib odbccp32.lib /nologo /subsystem:console /incremental:yes /pdb:"$(OUTDIR)\Pacman.pdb" /debug /machine:I386 /out:"$(OUTDIR)\Pacman.exe" /pdbtype:sept 
LINK32_OBJS= \
	"$(INTDIR)\Camera.obj" \
	"$(INTDIR)\Character.obj" \
	"$(INTDIR)\Dot.obj" \
	"$(INTDIR)\Environment.obj" \
	"$(INTDIR)\Floor.obj" \
	"$(INTDIR)\Game.obj" \
	"$(INTDIR)\Ghost.obj" \
	"$(INTDIR)\KeyBinder.obj" \
	"$(INTDIR)\Level.obj" \
	"$(INTDIR)\Object.obj" \
	"$(INTDIR)\Pacman.obj" \
	"$(INTDIR)\PacmanGame.obj" \
	"$(INTDIR)\PriorityQueue.obj" \
	"$(INTDIR)\Terrain.obj" \
	"$(INTDIR)\Vector.obj"

"$(OUTDIR)\Pacman.exe" : "$(OUTDIR)" $(DEF_FILE) $(LINK32_OBJS)
    $(LINK32) @<<
  $(LINK32_FLAGS) $(LINK32_OBJS)
<<

!ENDIF 


!IF "$(NO_EXTERNAL_DEPS)" != "1"
!IF EXISTS("Pacman.dep")
!INCLUDE "Pacman.dep"
!ELSE 
!MESSAGE Warning: cannot find "Pacman.dep"
!ENDIF 
!ENDIF 


!IF "$(CFG)" == "Pacman - Win32 Release" || "$(CFG)" == "Pacman - Win32 Debug"
SOURCE=..\..\Camera.cpp

"$(INTDIR)\Camera.obj" : $(SOURCE) "$(INTDIR)"
	$(CPP) $(CPP_PROJ) $(SOURCE)


SOURCE=..\..\Character.cpp

"$(INTDIR)\Character.obj" : $(SOURCE) "$(INTDIR)"
	$(CPP) $(CPP_PROJ) $(SOURCE)


SOURCE=..\..\Dot.cpp

"$(INTDIR)\Dot.obj" : $(SOURCE) "$(INTDIR)"
	$(CPP) $(CPP_PROJ) $(SOURCE)


SOURCE=..\..\Environment.cpp

"$(INTDIR)\Environment.obj" : $(SOURCE) "$(INTDIR)"
	$(CPP) $(CPP_PROJ) $(SOURCE)


SOURCE=..\..\Floor.cpp

"$(INTDIR)\Floor.obj" : $(SOURCE) "$(INTDIR)"
	$(CPP) $(CPP_PROJ) $(SOURCE)


SOURCE=..\..\Game.cpp

"$(INTDIR)\Game.obj" : $(SOURCE) "$(INTDIR)"
	$(CPP) $(CPP_PROJ) $(SOURCE)


SOURCE=..\..\Ghost.cpp

"$(INTDIR)\Ghost.obj" : $(SOURCE) "$(INTDIR)"
	$(CPP) $(CPP_PROJ) $(SOURCE)


SOURCE=..\..\KeyBinder.cpp

"$(INTDIR)\KeyBinder.obj" : $(SOURCE) "$(INTDIR)"
	$(CPP) $(CPP_PROJ) $(SOURCE)


SOURCE=..\..\Level.cpp

"$(INTDIR)\Level.obj" : $(SOURCE) "$(INTDIR)"
	$(CPP) $(CPP_PROJ) $(SOURCE)


SOURCE=..\..\Object.cpp

"$(INTDIR)\Object.obj" : $(SOURCE) "$(INTDIR)"
	$(CPP) $(CPP_PROJ) $(SOURCE)


SOURCE=..\..\Pacman.cpp

"$(INTDIR)\Pacman.obj" : $(SOURCE) "$(INTDIR)"
	$(CPP) $(CPP_PROJ) $(SOURCE)


SOURCE=..\..\PacmanGame.cpp

"$(INTDIR)\PacmanGame.obj" : $(SOURCE) "$(INTDIR)"
	$(CPP) $(CPP_PROJ) $(SOURCE)


SOURCE=..\..\PriorityQueue.cpp

"$(INTDIR)\PriorityQueue.obj" : $(SOURCE) "$(INTDIR)"
	$(CPP) $(CPP_PROJ) $(SOURCE)


SOURCE=..\..\Terrain.cpp

"$(INTDIR)\Terrain.obj" : $(SOURCE) "$(INTDIR)"
	$(CPP) $(CPP_PROJ) $(SOURCE)


SOURCE=..\..\Vector.cpp

"$(INTDIR)\Vector.obj" : $(SOURCE) "$(INTDIR)"
	$(CPP) $(CPP_PROJ) $(SOURCE)



!ENDIF 

