#ifndef FLOOR_H
#define FLOOR_H

#include <GL/gl.h>
#include <GL/glu.h>
#include <iostream>
#include "Constants.h"
#include "Terrain.h"

class Floor : public Terrain{
	private:
	//inherited:
	//Vector position
	//double scale;
	//double level;
	//double height;
	//Terrain * north;
	//Terrain * south;
	//Terrain * east;
	//Terrain * west;
	//Terrain * above;
	//Terrain * below;

	GLfloat * material_emission;
	GLfloat * material_normal;

	public:
	Floor(double _height, double _scale);
	void draw(float transparency);
	void drawWalls(float transparency);
	double getHeight(){ return height; };
	bool intersect(Vector v);
	int updateDot(Vector pos, double rad);
};

#endif
