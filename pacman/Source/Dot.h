#ifndef DOT_H
#define DOT_H

#include "Object.h"
#include "Vector.h"
using namespace std;

class Vector;

class Dot : public Object{

private:
	//Vector position;	//center location of character
	//Vector facing;		//normalized direction character is facing
	//double roll, pitch, yaw;
	//Terrain * location;	//Terrain character is positioned over
	//double projectionMatrix[16];
	//double alpha;
	//double scale;

	double radius;
	GLUquadric * qd;

public:

	Dot(Vector startPos);
	void draw();
	int collisionTest(Vector pos, double rad);
	void setRadius(double rad) { radius = rad; };
};



#endif