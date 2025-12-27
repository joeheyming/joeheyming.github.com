#ifndef CHARACTER_H
#define CHARACTER_H

#include <GL/gl.h>
#include <GL/glu.h>
#include <iostream>
#include "Level.h"
#include "Vector.h"

/*#define UP {
#define DOWN
#define LEFT
#define RIGHT
*/

using namespace std;

class Character{
private:

protected:
	Vector position;	//center location of character
	Vector facing;		//normalized direction character is facing
	double roll, pitch, yaw;
	double speed;
	Terrain * location;	//Terrain character is positioned over
	double projectionMatrix[16];
	double alpha;


public:
	Character();
	void setCoords(double _x, double _y, double _z){
		position = Vector(_x, _y, _z);
	};
	Vector getCoords(){ return position; };
	Vector getFacing(){ return facing; };
	virtual void draw() = 0;
	virtual void move(char direction, int mode) = 0;
	virtual void animate() = 0;
	//bool collision(Level * level);
	double getYaw(){return yaw;};
	double getPitch(){ return pitch; };
	double * getProjection(){ return projectionMatrix; }
	void incrementYaw(){yaw += 5;};
	void decrementYaw(){yaw -= 5;};
	void incrementPitch(){pitch ++;};
	void decrementPitch(){pitch --;};
	void transparentOn(double a){alpha = a;};
	void transparentOff(){alpha = 1.0;};
	void setYaw(double y){ yaw = y;};
};

#endif
