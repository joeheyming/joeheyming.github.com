#ifndef GAME_H
#define GAME_H

#include "Environment.h"
//#include "Sound.h"
#include "KeyBinder.h"
#include "Constants.h"
#include <string>
#include <iostream>
#include <GL/gl.h>
#include <GL/glu.h>

#include "WebWrapper.h"
//#include <mmsystem.h>


using namespace std;

class KeyBinder;


class Game{
private:
	Environment * env;
	KeyBinder * kBinder;
	int cameraMode, keyboardMode;
	int * gameMode;
	double winWidth, winHeight;
	double nearZ, farZ;

	// variables that rotate and translate the world
	// while running the program
	float angle, angle2;
	float i, j, k, ir, jr, kr;

	//default strides for world movement and rotation
	int moveStride;
	double rotateStride;

	//variables for mouse movement and idle motion
	int isMoving, moveX, moveY;
	int isRotating;
	int scale;
	int keyPressed;

	GLfloat xxx;
	GLfloat yyy;
	GLfloat zzz;

	GLfloat * my_ambient_light;
	GLfloat * my_diffuse_light;
	GLfloat * my_specular_light;
	GLfloat * my_light_position;

	string startLevel;


public:
	friend class KeyBinder;
	Game();
	void readInConfig(char * filename);
	void draw();
	void update();
	void displayFcn();
	void mouseFcn(int button, int state, int x, int y);
	void idleFcn();
	void updateFcn(int x);
	void reshapeFcn(int newWidth, int newHeight);
	void motionFcn(int x, int y);
	void specialFcn(int keys, int x, int y);
	void keyboardFcn(unsigned char key, int x, int y);
	void passiveMouseFcn(int x, int y);
	void displayAxis();
	int getGameMode(){ return *gameMode; };
	void setGameMode(int _gameMode){ *gameMode = _gameMode; };
	double getWidth(){ return winWidth; };
	double getHeight(){ return winHeight; };
};

#endif
