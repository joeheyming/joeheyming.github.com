#ifndef SOUND_H
#define SOUND_H

#include <cmath>
#include <windows.h>
#include <mmsystem.h>

#define SNDQUE 10000

class Sound{

public:

static soundtype  SndPmtr[SNDQUE+1];
static int        gTenter;
static int        gTwait;
static int        gTexit;
static int        gTarray;
static BOOL       gTsig;
static HANDLE     gSThread;

Sound(){
	gSThread = NULL;
}


//int     sound_ (float,int=0,int=127,int=0,float=1);
// changed this from int PlaySnd(void) to:
//DWORD WINAPI PlaySnd (LPVOID);



int sound_ (float Freq,int Dura,int Vol,int Voice,float Tempo)
{
        DWORD  dwThreadId;

        if (Freq == 0 && Dura < 1) return gTenter-gTexit;
        // silence
        if (Freq == 0) Vol = 0;
        if (Dura < 5) Dura = 5;
        gTenter++;
        gTsig = FALSE;
        if (gTenter >= SNDQUE)
        {
                gTarray = gTenter % SNDQUE+1;
        }
        else
        {
                gTarray=gTenter;
        }
        SndPmtr[gTarray].Freq = Freq;
        SndPmtr[gTarray].Dura = Dura;
        SndPmtr[gTarray].Tempo = Tempo;
        SndPmtr[gTarray].Vol = Vol;
        SndPmtr[gTarray].Voice = Voice;
        SndPmtr[gTarray].sndTid = gTenter;
        if (gSThread == NULL && (Freq == abs(Freq) || Freq == 0))
        {
                // "PlaySnd" needs casting (void *)
                gSThread = CreateThread(NULL,0,PlaySnd,(void *)"PlaySnd",0,(void *)(&dwThreadId));
                Sleep(1);
                return 0;
        }
        if (Freq != abs(Freq))
        {
                if (Freq == -1)
                {
                        Freq = 0;
                        SndPmtr[gTarray].Vol=0;
                }
                SndPmtr[gTarray].Freq=abs(Freq);
                gTsig=TRUE;
                while(gSThread!=NULL)
                {
                        Sleep(10);
                }
                gTexit = gTenter-1;
                gTwait = gTenter-1;
                gTsig = FALSE;
                return PlaySnd(0);  // needs some kind of argument
        }
        return 0;
}


DWORD WINAPI PlaySnd (LPVOID)
{
        soundtype  LocSndPar;
        int  lTarray;

        while(gTenter > gTexit && gTsig == FALSE)
        {
                gTwait++;
                if (gTwait >= SNDQUE)
                lTarray = gTwait % SNDQUE+1;
                else
                lTarray = gTwait;
                LocSndPar = SndPmtr[lTarray];
                int Note = 0;
                int Phrase = 0;
                HMIDIOUT hMidi;
                midiOutOpen(&hMidi,(UINT)-1,0,0,CALLBACK_NULL);
                midiOutShortMsg(hMidi,(256*LocSndPar.Voice)+192);
                // convert frequency to midi note
                Note = (int)(log(LocSndPar.Freq)-log(440.0)/log(2.0)*12+69,0);
                Phrase = (LocSndPar.Vol*256+Note)*256+144;
                midiOutShortMsg(hMidi,Phrase);
                Sleep((int)(LocSndPar.Dura*(1/LocSndPar.Tempo+0.0001)));
                Phrase = (LocSndPar.Vol*256+Note)*256+128;
                midiOutShortMsg(hMidi,Phrase);
                midiOutClose(hMidi);
                gTexit++;
        }
        CloseHandle(gSThread);
        gSThread = NULL;
        return 0;
}

};

#endif