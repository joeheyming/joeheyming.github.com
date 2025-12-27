#ifndef TERRAIN_H
#define TERRAIN_H

#include <GL/gl.h>
#include <GL/glu.h>
#include <iostream>
#include "Vector.h"
#include "Dot.h"
//#include "Constants.h"

using namespace std;

//class Dot;

class Terrain{
protected:
	Vector position;
	double scale;
	double level;
	double height;
	Terrain * north;
	Terrain * south;
	Terrain * east;
	Terrain * west;
	Terrain * above;
	Terrain * below;
	Dot * dot;

	double heuristicValue;

public:
	Terrain(double _scale);
	Terrain();
	virtual double getHeight() = 0;
	double getLevel(){ return level; };
	Vector getCoords(){ return position; };
	void setCoords(double _x, double _y, double _z);
	virtual void draw(float transparency) = 0;
	void setNorth(Terrain * p){ north = p; };
	void setSouth(Terrain * p){ south = p; };
	void setEast(Terrain * p){ east = p; };
	void setWest(Terrain * p){ west = p; };
	void setAbove(Terrain * p){ above = p; };
	void setBelow(Terrain * p){ below = p; };
	Terrain * getNorth(){ return north; };
	Terrain * getSouth(){ return south; };
	Terrain * getEast(){ return east; };
	Terrain * getWest(){ return west; };
	Terrain * getAbove(){ return above; };
	Terrain * getBelow(){ return below; };
	virtual bool intersect(Vector v) = 0;
	void setDot(double rad){ dot->setRadius(rad); };
	Dot * getDot(){return dot;};
	virtual int updateDot(Vector pos, double rad){return 0;};
};

#endif
