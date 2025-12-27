#include "Terrain.h"

Terrain::Terrain(double _scale){
	scale = _scale;
}

Terrain::Terrain(){
	scale = 10;
}

void Terrain::setCoords(double _x, double _y, double _z){
	position.x = _x * scale;
	position.y = _y * scale;
	position.z = _z * scale;
}

