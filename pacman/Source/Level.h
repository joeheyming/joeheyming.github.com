#ifndef LEVEL_H
#define LEVEL_H

#include "Terrain.h"
#include "Floor.h"
#include "Dot.h"
#include <iostream>
#include <string>
#include <math.h>
#include <vector>

using namespace std;

typedef Terrain * TerrainP;
typedef TerrainP * TerrainPP;

//typedef Dot * DotP;

class Dot;

class Level{
private: 
	TerrainPP * terrains;
	int ** map;
	//vector<Dot*> * dots;
	/* width of map, length of map,
	base height to start drawing at */
	double width, length, base, scale;
	void interpretMap();
	double dotSize;
	double powerPillSize;
	vector<Vector> * ghostHome;
	vector<Vector> * powerPills;
	vector<Vector> * teleports;

public:
	Level(){};
	void setLevel(int ** _map, double _width, double _length, 
		double _base, double _scale, vector<Vector> * ghostHome, 
		vector<Vector> * powerPills, vector<Vector> * _teleports);
	void draw();
	TerrainPP * getTerrains(){ return terrains; };
};


#endif
