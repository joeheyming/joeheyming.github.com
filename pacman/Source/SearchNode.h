#ifndef SEARCHNODE_H
#define SEARCHNODE_H

#include "Terrain.h"

class SearchNode{
public:
	Terrain * terrain;
	
	SearchNode * parent;

	double heuristicValue;
	double cost;
	double total;

	bool onOpen;
	bool onClosed;
};

#endif