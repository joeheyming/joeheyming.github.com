#include "Level.h"

void Level::setLevel(int ** _map, double _width, 
			double _length, double _base, double _scale, 
			vector<Vector> * _ghostHome, vector<Vector> * _powerPills,
			vector<Vector> * _teleports){
	map = _map; 
	width = _width;
	length = _length; 
	base = _base;
	scale = _scale;

	//generate terrain based off characters in map
	terrains = new TerrainPP[(int)length];

	dotSize = 1;
	powerPillSize = 2;

	ghostHome = _ghostHome;
	powerPills = _powerPills;
	teleports = _teleports;
	
	interpretMap();
}

void Level::interpretMap(){
	Floor * tempFloor;
	int row;

	for(row = 0; row < length; row++){
	  terrains[row] = new TerrainP[(int)width]; 
		for(int column = 0; column < width; column++){
			tempFloor = new Floor(map[row][column], scale);
			tempFloor->setCoords(column, row, base);
			terrains[row][column] = tempFloor;
			if(tempFloor->getHeight() == 1){
				tempFloor->setDot(dotSize);
			}
		}
	}

	//remove dots from ghost home
	for(int i = 0; i < ghostHome->size(); i++){
		terrains[(int)(*ghostHome)[i].y][(int)(*ghostHome)[i].x]->setDot(0);
	}

	//add power pills to level
	for(int j = 0; j < powerPills->size(); j++){
		terrains[(int)(*powerPills)[j].y][(int)(*powerPills)[j].x]
			->setDot(powerPillSize);
	}
	
	cout << "linking terrain" << endl;
	// link all the terrains to each other
	for(row = 0; row < length; row++){
		for(int column = 0; column < width; column++){
			if(row+1 < length)
				terrains[row][column]->setNorth(
				terrains[row+1][column]);
			if(row-1 > -1)
				terrains[row][column]->setSouth(
				terrains[row-1][column]);
			if(column-1 > -1)
				terrains[row][column]->setWest(
				terrains[row][column-1]);
			if(column+1 < width)
				terrains[row][column]->setEast(
				terrains[row][column+1]);
		}
	}

	//add teleports to level
	terrains[(int)(*teleports)[0].y][(int)(*teleports)[0].x]
		->setWest(terrains[(int)(*teleports)[1].y][(int)(*teleports)[1].x]);
	terrains[(int)(*teleports)[1].y][(int)(*teleports)[1].x]
		->setEast(terrains[(int)(*teleports)[0].y][(int)(*teleports)[0].x]);
}

void Level::draw(){
	float transparency = 0.1;
	if(base < 9)
		transparency = 1 - 0.1*(float)base;

	for(int row = 0; row < length; row++)
		for(int column = 0; column < width; column++)
			terrains[row][column]->draw(transparency);
}
