#ifndef ENVIRONMENT_H
#define ENVIRONMENT_H

#include <GL/gl.h>
#include <GL/glu.h>
#include <iostream>
#include <fstream>
#include "Character.h"
#include "Pacman.h"
#include "Ghost.h"
#include "Level.h"
#include "Camera.h"

using namespace std;

typedef int * intP;
typedef intP * intPP;
typedef Ghost * GhostP;
typedef Level * LevelP;

class Camera;

class Environment{
private:
	// array of characters
	GhostP * ghosts; 
	Pacman * player; // human player
	Ghost * enemy; // computer player

	// array of level objects
	LevelP *  levels;
	intPP * map;//holds a mapping of the levels
	double width, length, numLevels, scale;//dimensions of map

	int numCharacters, numPacmen, numGhosts;

	int pacmanX, pacmanY, pacmanLevel;
	Vector ghost;//int ghostX, ghostY, ghostLevel;
	int cameraMode;
	int ghostHomeSize;
	vector<Vector> * ghostHome;
	int numPowerPills;
	vector<Vector> * powerPills;
	vector<Vector> * teleports; //only two teleporters

	int * gameStatus;
	string startLevel;

public:
	// constructor
	Environment(int * _gameStatus, string _startLevel);
	
	// draw method
	void draw();
	void fileReader(string filename);
	Pacman * getPlayer(){ return player; };
	Camera * cam;
	double getWidth(){ return width; };
	double getLength(){ return length; };
	double getScale(){ return scale; };
	void setCameraMode(int mode){cameraMode = mode;};
	void update();
};


#endif
