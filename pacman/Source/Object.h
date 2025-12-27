#ifndef OBJECT_H
#define OBJECT_H

#include <GL/gl.h>
#include <GL/glu.h>
#include <iostream>
//#include "Level.h"
#include "Vector.h"

class Level;
class Terrain;
class Vector;

class Object{
protected:
	Vector position;	//center location of character
	Vector facing;		//normalized direction character is facing
	double roll, pitch, yaw;
	Terrain * location;	//Terrain character is positioned over
	double projectionMatrix[16];
	double alpha;
	double scale;


public:
	Object();
	void setCoords(double _x, double _y, double _z){
		position = Vector(_x, _y, _z);
	};
	Vector getCoords(){ return position; };
	Vector getFacing(){ return facing; };
	virtual void draw() = 0;
	bool collision(Level * level);
	void transparentOn(){alpha = 0.25;};
	void transparentOff(){alpha = 1.0;};

};


#endif