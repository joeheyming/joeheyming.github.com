#ifndef GHOST_H
#define GHOST_H

#include <GL/gl.h>
#include <GL/glu.h>
#include <iostream>
#include <math.h>
#include "Character.h"
#include "Vector.h"
#include "Constants.h"
#include <vector>
#include "PriorityQueue.h"
#include <cstdlib>
#include <ctime>
#include "WebWrapper.h"

using namespace std;


class Game;
class Ghost : public Character{
private:
	//inherits:
	//Vector position, facing
	//double roll, pitch, yaw;
	//double speed;
	//Terrain * location;

	Vector screenPt;
	Vector up, down, left, right;
	double radius, scale;
	double moveSpeed, homeSpeed;
	GLUquadric * qd;

	double red, green, blue;

	Terrain * home;

	Terrain * location;
	Terrain * lastLoc;
	Terrain * nextLoc; // terrain that the ghost is moving toward

	void drawHead();
	void drawBody();
	void drawEyes();
	void drawMouth();
	int collision();

	Vector pacLoc;
	int pacStatus;
	double pacRad;

	PriorityQueue movesHome;	// used for A* path generation
	vector <Terrain*> path;	// used for actual movement of ghost

	bool dead; // if dead, go straight home
	bool moving; // whether or not ghost is currently in motion

	int searchLimit;

	int * gameStatus;

public:
	Ghost(double startx, double starty, double startz, double _scale,
			Terrain * p, double _pacRad, int * _gameStatus);
	void draw();
	Terrain * getLocation(){ return location; };
	void animate(){};
	void faceMouse(int x, int y, int mode){};
	void move(char direction, int mode){};
	void move();
	void update(Vector _pacLoc, int _pacStatus);
	void generatePath();
	void generateGreedyPath();
	void goHome(SearchNode *);
	vector<Terrain*> getSurrounding();
	vector<Terrain*> getSurrounding(Terrain * current, Terrain * last);
	double heuristic(Terrain * t);
	void addToQueue(vector <Terrain*> choices);
	void calculatePath(SearchNode* node);
	bool pacmanTest(Terrain * current);
	bool homeTest(Terrain * current);
};

#endif
