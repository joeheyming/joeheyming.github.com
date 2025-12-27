#ifndef KEYBINDER_H
#define KEYBINDER_H

#include "Game.h"
#include <GL/gl.h>
#include <GL/glu.h>
#include <iostream>
#include <fstream>

class Game;

class KeyBinder{
private:
	Game * game;
	int toggleView, toggleGameMode;
	void mouseDebugFcn(int button, int state, int x, int y);
	void specialDebugFcn(int key, int x, int y);
	void keyboardDebugFcn(unsigned char key, int x, int y);

	void mouseGameFcn(int button, int state, int x, int y);
	void specialGameFcn(int key, int x, int y);
	void keyboardGameFcn(unsigned char key, int x, int y);
	void setDebug();

public:
	friend class Game;
	KeyBinder(Game * g);
	
	void mouseFcn(int button, int state, int x, int y);
	void specialFcn(int keys, int x, int y);
	void keyboardFcn(unsigned char key, int x, int y);
};


#endif
