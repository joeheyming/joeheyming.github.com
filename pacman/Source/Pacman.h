#ifndef PACMAN_H
#define PACMAN_H

#include <GL/gl.h>
#include <GL/glu.h>
#include <iostream>
#include <math.h>
#include "Character.h"
#include "Vector.h"
#include "Constants.h"
#include "WebWrapper.h"

#define PI 3.14159265
//enum { N, S, E, W, NE, SE, SW, NW};

//enum keymode{KEY_ROTATE, KEY_STRAFE};

class Pacman : public Character{
private:
	//inherits:
	//Vector position, facing
	//double roll, pitch, yaw;
	//double speed;
	//Terrain * location;
	//double alpha;

	Vector screenPt;
	Vector strafe;
	double radius, scale;
	double moveSpeed, rotateSpeed;
	double clip_top[4];
	double clip_bottom[4];
	Vector left;
	Vector right;
	Vector up;
	Vector down;
	double mouthAngle;
	GLUquadric * qd;
	int toggle; // changes direction of mouth animation

	Terrain * location;

	void drawTop();
	void drawBottom();
	void drawEyes();
	int collision();
	void testDot();

	int status;
	int score;

	int counter;

	bool chomp; //whether or not to animate mouth

	int * gameStatus;

	vector<Vector> * teleports;

public:
	Pacman(double startx, double starty, 
			double startz, double _scale,
			Terrain * p, int * _gameStatus,
			vector<Vector> * _teleports);
	void draw();
	void move(char direction, int mode);
	void animate();
	void faceMouse(double x, double y, int mode);
	void setScreenPt(double thX, double thY,
					double nearZ, double farZ,
					double width, double height);
	Terrain * getLocation(){ return location; };
	double getRadius(){ return radius; };
	int getStatus(){ return status; };
	void deathAnimation();
	void update();
};

#endif
