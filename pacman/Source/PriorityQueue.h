#ifndef PRIORITYQUEUE_H
#define PRIORITYQUEUE_H

#include <vector>
#include <algorithm>
#include "SearchNode.h"
#include "Compare.h"

using namespace std;

class PriorityQueue{
private:
	vector <SearchNode*> heap;
public:
	SearchNode* pop(); //remove front element
	void push(SearchNode* node);
	bool empty(){ return heap.empty(); };
	void update(SearchNode* node);
	void clear(){ heap.clear(); };
};

#endif